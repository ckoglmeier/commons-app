import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, memberships, people, coordinatorTurns, auditEvents } from "./schema";
import { commitCoordinatorTurn, actOnCoordinatorWorkspace, getCoordinatorThread } from "./coordinator-repository";
import { getEventAttendance, setEventAttendance } from "./attendance-repository";

test("explicit attendance commits with the conversation, replay is safe, and undo cannot overwrite later answers", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
  const db = createDatabase(url), event = randomUUID(), owner = randomUUID(), other = randomUUID(), outsider = randomUUID();
  const options = { databaseUrl: url, actorPersonId: owner, sharedCoordinator: true };
  const input = { commandId: randomUUID(), version: 0, prompt: "We're both attending.", draftId: null, draftVersion: null };
  const commit = (request = input, opts = options) => commitCoordinatorTurn(event, request, "Recording attendance.", null, opts, { tripConversation: true });
  const states = async () => (await getEventAttendance(event, options)).people;
  try {
    await db.db.insert(people).values([{id: owner, displayName: "Alex", authUserId: owner}, {id: other, displayName: "Sam", authUserId: other}, {id: outsider, displayName: "Taylor", authUserId: outsider}]);
    await db.db.insert(commons).values({ id: event, slug: event, name: "Synthetic attendance trip", createdByPersonId: owner, timezone: "America/Denver", startsOn: "2026-12-20", endsOn: "2026-12-23" });
    await db.db.insert(memberships).values([owner, other].map(personId => ({ commonsId: event, personId, role: "organizer" as const, status: "active" as const })));
    await assert.rejects(commit(input, {...options, actorPersonId: outsider}));
    await commit();
    await commit();
    assert.ok((await states()).every(p => p.state === "attending"));
    const first = (await getCoordinatorThread(event, options)).turns[0];
    assert.match(first.assistantText, /You and Sam are marked as attending/);
    assert.equal(first.workspace?.attendanceReceipt?.people.length, 2);
    assert.equal((await db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.commonsId, event))).length, 1);
    const undo = {turnId: first.id, commandId: randomUUID(), action: "undo_attendance"};
    await assert.rejects(actOnCoordinatorWorkspace(event, undo, {...options, actorPersonId: other}));
    await actOnCoordinatorWorkspace(event, undo, options);
    await actOnCoordinatorWorkspace(event, undo, options);
    assert.ok((await states()).every(p => p.state === "helping"));
    // Retrying the original message after undo never reapplies it.
    await commit();
    assert.ok((await states()).every(p => p.state === "helping"));
    await commit({...input, commandId: randomUUID(), version: 1});
    const second = (await getCoordinatorThread(event, options)).turns.at(-1)!;
    await setEventAttendance(event, {commandId: randomUUID(), state: "helping", reviewedDates: "2026-12-20/2026-12-23"}, {...options, actorPersonId: other});
    await assert.rejects(actOnCoordinatorWorkspace(event, {...undo, turnId: second.id, commandId: randomUUID()}, options));
    assert.equal((await states()).find(p => p.personId === owner)?.state, "attending", "failed undo rolls back all travelers");
    // A stale conversation cannot partially save attendance.
    await assert.rejects(commit({...input, commandId: randomUUID(), version: 0}));
    assert.equal((await states()).find(p => p.personId === other)?.state, "helping");
    // Unknown group scope changes nobody.
    await db.db.insert(memberships).values({commonsId: event, personId: outsider, role: "member", status: "active"});
    await commit({...input, commandId: randomUUID(), version: 2});
    assert.equal((await states()).find(p => p.personId === outsider)?.state, "helping");
    assert.match((await getCoordinatorThread(event, options)).turns.at(-1)!.assistantText, /Who do you mean/);
    await commit({...input, commandId: randomUUID(), version: 3, prompt: "Sam and I are attending"});
    assert.equal((await states()).find(p => p.personId === other)?.state, "attending");
    const named = (await getCoordinatorThread(event, options)).turns.at(-1)!;
    await db.db.update(commons).set({endsOn: "2026-12-24"}).where(eq(commons.id,event));
    await assert.rejects(actOnCoordinatorWorkspace(event, {...undo, turnId: named.id, commandId: randomUUID()}, options));
    assert.ok((await states()).filter(p=>p.personId!==outsider).every(p=>p.state === "needs_confirmation"));
    await db.db.update(commons).set({startsOn: null, endsOn: null}).where(eq(commons.id,event));
    await commit({...input, commandId: randomUUID(), version: 4, prompt: "I'm attending"});
    assert.match((await getCoordinatorThread(event, options)).turns.at(-1)!.assistantText, /Which trip dates/);
    assert.ok((await db.db.select().from(auditEvents).where(eq(auditEvents.commonsId,event))).some(a=>a.action === "coordinator.attendance_recorded" && a.actorId === owner));
  } finally {
    await db.db.delete(commons).where(eq(commons.id, event));
    await db.db.delete(people).where(inArray(people.id, [owner, other, outsider]));
    await db.close();
  }
});
