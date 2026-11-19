import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { addCommonsItineraryItem, updateCommonsItineraryItem, updateCommonsParticipation, getCommonsSnapshot } from "./pilot-repository";
import { commons, memberships, people, participation } from "./schema";

test("specific people persists planned inclusion, protects real responses, and isolates event membership", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, "Explicit disposable TEST_DATABASE_URL required");
  const database = createDatabase(url);
  const org = randomUUID(), member = randomUUID(), child = randomUUID(), outsider = randomUUID(), departed = randomUUID();
  const event = randomUUID(), slug = `people-${event}`;
  const options = { databaseUrl: url, actorPersonId: org };
  const command = (extra: Record<string, unknown> = {}) => ({ commandId: randomUUID(), title: "Museum visit", date: null, time: null, participantScope: "subgroup", expectedParticipantIds: [member, child], occurredAt: new Date().toISOString(), ...extra });
  try {
    await database.db.insert(people).values([org, member, child, outsider, departed].map(id => ({ id, displayName: id === child ? "Managed traveler" : "QA person" })));
    await database.db.insert(commons).values({ id: event, slug, name: "Plan people QA", timezone: "UTC", createdByPersonId: org });
    await database.db.insert(memberships).values([
      { commonsId: event, personId: org, role: "organizer", status: "active" },
      { commonsId: event, personId: member, role: "member", status: "active" },
      { commonsId: event, personId: child, role: "member", status: "active", accessMode: "managed", managedByPersonIds: [org] },
      { commonsId: event, personId: departed, role: "member", status: "left" },
    ]);
    const add = command({ arrangerPersonId: org, expectedCostCents: 2500, expectedCostBasis: "per_person" });
    const initial = await addCommonsItineraryItem(slug, add, options);
    assert.ok(initial);
    const id = initial.state.itinerary[0].id;
    const update = (extra: Record<string, unknown> = {}) => updateCommonsItineraryItem(slug, id, command(extra), options);
    assert.equal(initial.state.itinerary[0].participantScope, "subgroup");
    assert.deepEqual(new Set(initial.state.itinerary[0].expectedParticipantIds), new Set([member, child]));
    assert.deepEqual(initial.state.itinerary[0].participantIds, []);
    assert.deepEqual(initial.state.itinerary[0].respondedParticipantIds, []);
    assert.equal((await getCommonsSnapshot(slug, { ...options, actorPersonId: member }))!.state.participation[id], undefined);
    assert.equal(initial.state.expenses.length, 0);
    await addCommonsItineraryItem(slug, add, options);
    assert.equal((await getCommonsSnapshot(slug, options))!.state.itinerary.length, 1);
    const scheduled = await update({ date: "2027-03-20", time: "14:00", expectedParticipantIds: [child], expectedCostCents: 2500, expectedCostBasis: "per_person" });
    assert.equal(scheduled!.state.itinerary[0].id, id);
    assert.equal(scheduled!.state.itinerary[0].arrangerPersonId, org);
    assert.equal(scheduled!.state.itinerary[0].status, "idea", "assigning a date preserves the independent saved status");
    assert.deepEqual(scheduled!.state.itinerary[0].expectedParticipantIds, [child]);
    assert.match(scheduled!.state.itinerary[0].provenanceLabel, /added this/);
    assert.equal((await database.db.select().from(participation).where(eq(participation.itineraryItemId, id))).length, 1);
    for (const invalid of [outsider, departed]) {
      await assert.rejects(update({ expectedParticipantIds: [invalid] }), { code: "actor_not_authorized" });
      await assert.rejects(addCommonsItineraryItem(slug, command({ expectedParticipantIds: [invalid] }), options), { code: "actor_not_authorized" });
    }
    await assert.rejects(updateCommonsItineraryItem(slug, id, command(), { ...options, actorPersonId: outsider }), { code: "actor_not_authorized" });
    // Scope changes reuse the same item and remove obsolete planning-only rows.
    for (const scope of ["everyone", "optional"]) {
      const open = await update({ participantScope: scope, expectedParticipantIds: [] });
      assert.equal(open!.state.itinerary[0].participantScope, scope);
      assert.deepEqual(open!.state.itinerary[0].expectedParticipantIds, []);
      await update();
    }
    for (const response of ["maybe", "in"] as const) {
      await updateCommonsParticipation(slug, id, { commandId: randomUUID(), response, occurredAt: new Date().toISOString() }, { ...options, actorPersonId: member });
      await assert.rejects(update({ title: "Should not save", expectedParticipantIds: [child] }), { code: "itinerary_conflict" });
      const saved = await update({ expectedParticipantIds: [member] });
      assert.equal(saved!.state.itinerary[0].title, "Museum visit");
      assert.deepEqual(saved!.state.itinerary[0].respondedParticipantIds, [member]);
      assert.equal((await getCommonsSnapshot(slug, { ...options, actorPersonId: member }))!.state.participation[id], response);
    }
    await updateCommonsParticipation(slug, id, { commandId: randomUUID(), response: "skip", occurredAt: new Date().toISOString() }, { ...options, actorPersonId: member });
    await assert.rejects(update(), { code: "itinerary_conflict" });
    await update({ expectedParticipantIds: [child] });
    const final = await getCommonsSnapshot(slug, { ...options, actorPersonId: member });
    assert.equal(final!.state.participation[id], "skip");
    assert.deepEqual(final!.state.itinerary[0].expectedParticipantIds, [child]);
    assert.equal(final!.state.itinerary[0].arrangerPersonId, org);
    assert.equal(final!.state.expenses.length, 0);
  } finally {
    await database.db.delete(commons).where(eq(commons.id, event));
    await database.db.delete(people).where(inArray(people.id, [org, member, child, outsider, departed]));
    await database.close();
  }
});
