import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, memberships, people } from "./schema";
import { commitCoordinatorTurn } from "./coordinator-repository";
import { getEventAttendance, setEventAttendance } from "./attendance-repository";

test("conversation supplies a private self-only attendance review, with date and saved-response boundaries", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
  const db = createDatabase(url), event = randomUUID(), owner = randomUUID(), other = randomUUID(), outsider = randomUUID();
  const options = { databaseUrl: url, actorPersonId: owner, sharedCoordinator: true };
  try {
    await db.db.insert(people).values([owner, other, outsider].map(id => ({ id, displayName: "Synthetic attendance tester", authUserId: id })));
    await db.db.insert(commons).values({ id: event, slug: event, name: "Synthetic attendance trip", createdByPersonId: owner, timezone: "America/Denver", startsOn: "2026-12-20", endsOn: "2026-12-23" });
    await db.db.insert(memberships).values([owner, other].map(personId => ({ commonsId: event, personId, role: "organizer" as const, status: "active" as const, updatedAt: new Date("2026-01-01") })));
    await commitCoordinatorTurn(event, { commandId: randomUUID(), version: 0, prompt: "I'm attending.", draftId: null, draftVersion: null }, "Private legacy exchange.", null, { ...options, sharedCoordinator: false });
    assert.equal((await getEventAttendance(event, options)).reportedAttendance, null, "legacy private conversation is not imported");
    await commitCoordinatorTurn(event, { commandId: randomUUID(), version: 0, prompt: "We're both attending.", draftId: null, draftVersion: null }, "Save your attendance below.", null, options);
    const initial = await getEventAttendance(event, options);
    assert.equal(initial.reportedAttendance?.source, "We're both attending.");
    assert.ok(initial.people.every(person => person.state === "helping"), "a statement never saves an RSVP");
    assert.equal((await getEventAttendance(event, { ...options, actorPersonId: other })).reportedAttendance, null, "another organizer cannot see the personal shortcut or source");
    await assert.rejects(getEventAttendance(event, { ...options, actorPersonId: outsider }));
    await assert.rejects(setEventAttendance(event, { commandId: randomUUID(), state: "attending", reviewedDates: "2026-12-19/2026-12-23" }, options));
    const command = { commandId: randomUUID(), state: "attending", reviewedDates: initial.dates };
    await setEventAttendance(event, command, options);
    await setEventAttendance(event, command, options);
    const saved = await getEventAttendance(event, options);
    assert.equal(saved.reportedAttendance, null);
    assert.equal(saved.people.find(person => person.personId === owner)?.state, "attending");
    assert.equal(saved.people.find(person => person.personId === other)?.state, "helping");
    await db.db.update(commons).set({ endsOn: "2026-12-24" }).where(eq(commons.id, event));
    assert.equal((await getEventAttendance(event, options)).people.find(person => person.personId === owner)?.state, "needs_confirmation");
    await assert.rejects(setEventAttendance(event, { ...command, commandId: randomUUID() }, options));
    await setEventAttendance(event, { commandId: randomUUID(), state: "helping", reviewedDates: "2026-12-20/2026-12-24" }, options);
    assert.equal((await getEventAttendance(event, options)).reportedAttendance, null, "an explicit later response wins");
  } finally {
    await db.db.delete(commons).where(eq(commons.id, event));
    await db.db.delete(people).where(inArray(people.id, [owner, other, outsider]));
    await db.close();
  }
});
