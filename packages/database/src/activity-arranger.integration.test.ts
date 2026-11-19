import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { addCommonsItineraryItem, updateCommonsItineraryItem, getCommonsSnapshot } from "./pilot-repository";
import { commons, memberships, people, itineraryItems } from "./schema";

test("activity arranger survives edits without granting attendance or authority, rejects stale and ineligible assignments", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, "Explicit disposable TEST_DATABASE_URL required");
  const database = createDatabase(url);
  const org = randomUUID(), member = randomUUID(), outsider = randomUUID(), managed = randomUUID();
  const event = randomUUID(), other = randomUUID(), slug = `arranger-${event}`;
  const options = { databaseUrl: url, actorPersonId: org };
  const command = (extra: Record<string, unknown> = {}) => ({ commandId: randomUUID(), title: "Museum visit", date: null, time: null, location: "", note: "", participantScope: "self", occurredAt: new Date().toISOString(), ...extra });
  try {
    await database.db.insert(people).values([
      { id: org, displayName: "Organizer", authUserId: randomUUID() },
      { id: member, displayName: "Arranger", authUserId: randomUUID() },
      { id: outsider, displayName: "Outsider", authUserId: randomUUID() },
      { id: managed, displayName: "Managed traveler" },
    ]);
    await database.db.insert(commons).values([
      { id: event, slug, name: "Arranger QA", timezone: "UTC", createdByPersonId: org },
      { id: other, slug: `arranger-${other}`, name: "Other event", timezone: "UTC", createdByPersonId: outsider },
    ]);
    await database.db.insert(memberships).values([
      { commonsId: event, personId: org, role: "organizer", status: "active" },
      { commonsId: event, personId: member, role: "member", status: "active" },
      { commonsId: event, personId: managed, role: "member", status: "active", accessMode: "managed", managedByPersonIds: [org] },
      { commonsId: other, personId: outsider, role: "organizer", status: "active" },
    ]);
    const initial = await addCommonsItineraryItem(slug, command(), options);
    assert.ok(initial);
    const id = initial.state.itinerary[0].id;
    assert.equal(initial.state.itinerary[0].arrangerPersonId, undefined);
    const update = (extra: Record<string, unknown>, actorPersonId = org) => updateCommonsItineraryItem(slug, id, command(extra), { ...options, actorPersonId });
    const assigned = await update({ arrangerPersonId: member, expectedArrangerPersonId: null });
    assert.ok(assigned);
    assert.equal(assigned.state.itinerary[0].arrangerName, "Arranger");
    assert.deepEqual(assigned.state.itinerary[0].participantIds, [org]);
    assert.equal(assigned.participants.find(p => p.id === member)?.role, "member");
    assert.equal(assigned.state.itinerary[0].status, "idea");
    assert.equal(assigned.state.expenses.length, 0);
    const scheduled = await update({ date: "2027-03-20", time: "10:00", title: "Museum and lunch" });
    assert.ok(scheduled);
    assert.equal(scheduled.state.itinerary[0].arrangerPersonId, member);
    assert.equal(scheduled.state.itinerary[0].provenanceLabel, assigned.state.itinerary[0].provenanceLabel);
    assert.equal((await getCommonsSnapshot(slug, options))?.state.itinerary[0].arrangerPersonId, member);
    await assert.rejects(update({ arrangerPersonId: org, expectedArrangerPersonId: null }), { code: "itinerary_conflict" });
    for (const personId of [outsider, managed]) {
      await assert.rejects(update({ arrangerPersonId: personId, expectedArrangerPersonId: member }), { code: "actor_not_authorized" });
      await assert.rejects(addCommonsItineraryItem(slug, command({ arrangerPersonId: personId }), options), { code: "actor_not_authorized" });
    }
    await assert.rejects(update({}, outsider), { code: "actor_not_authorized" });
    const clearCommand = command({ arrangerPersonId: null, expectedArrangerPersonId: member });
    await updateCommonsItineraryItem(slug, id, clearCommand, options);
    await updateCommonsItineraryItem(slug, id, clearCommand, options);
    const race = await Promise.allSettled([update({ arrangerPersonId: org, expectedArrangerPersonId: null }), update({ arrangerPersonId: member, expectedArrangerPersonId: null })]);
    assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
    const rejected = race.find(r => r.status === "rejected");
    assert.ok(rejected?.status === "rejected");
    assert.equal(rejected.reason.code, "itinerary_conflict");
    const winner = (await getCommonsSnapshot(slug, options))?.state.itinerary[0].arrangerPersonId;
    assert.ok(winner);
    // Self-claim uses the same reviewed command; it does not make the member an event organizer.
    await update({ arrangerPersonId: member, expectedArrangerPersonId: winner, participantScope: "everyone" }, member);
    await database.db.update(memberships).set({ status: "left" }).where(and(eq(memberships.commonsId, event), eq(memberships.personId, member)));
    const departed = (await getCommonsSnapshot(slug, options))?.state.itinerary[0];
    assert.ok(departed);
    assert.equal(departed.arrangerPersonId, member);
    assert.equal(departed.arrangerName, "Arranger");
    assert.equal(departed.arrangerActive, false);
    await assert.rejects(update({ arrangerPersonId: member, expectedArrangerPersonId: member }), { code: "actor_not_authorized" });
    await assert.rejects(update({}, member), { code: "actor_not_authorized" });
    await update({ arrangerPersonId: null, expectedArrangerPersonId: member });
    const [row] = await database.db.select().from(itineraryItems).where(eq(itineraryItems.id, id));
    assert.equal(row.arrangerPersonId, null);
  } finally {
    await database.db.delete(commons).where(inArray(commons.id, [event, other]));
    await database.db.delete(people).where(inArray(people.id, [org, member, outsider, managed]));
    await database.close();
  }
});
