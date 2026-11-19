import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, people, memberships, expenses, tripBudgetWorksheets } from "./schema";
import { createEventCreationDraft, commitEventCreationDraft } from "./event-creation-repository";
import { readTripBudget, saveTripBudget } from "./trip-budget-repository";
import { CommandAccessError, CommandConflictError } from "./event-command";
import type { TripBudgetInputs } from "@commons/contracts";
const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
const url = process.env.TEST_DATABASE_URL ?? "";
const inputs: TripBudgetInputs = { currency: "USD", travelers: "8", nights: "3", lodgingBasis: "property", lodgingPerNight: "300", rooms: "", mealsPerPersonPerDay: "", mealDays: "", mealDaysFollowNights: true, transportTotal: "", activitiesTotal: "", travelPerPerson: "", bufferPercent: "", optional: [{ id: "extra-1", label: "Sunrise walk", perPerson: "", participants: "" }] };

test("trip budget persists raw edits, checks membership and versions, and never creates expenses", { skip }, async () => {
  assert.equal(new URL(url).hostname, "127.0.0.1");
  assert.ok(new URL(url).pathname.endsWith("_test"));
  const database = createDatabase(url);
  const owner = randomUUID(), member = randomUUID(), stranger = randomUUID();
  let tripId: string | undefined;
  try {
    await database.db.insert(people).values([owner, member, stranger].map(id => ({ id, authUserId: randomUUID(), displayName: "Budget test" })));
    const options = { databaseUrl: url, actorPersonId: owner };
    const draft = await createEventCreationDraft({ sourceKind: "description", title: "Synthetic budget", timezone: "UTC" }, options);
    const trip = await commitEventCreationDraft(draft.id, { commandId: randomUUID(), expectedVersion: draft.version }, options);
    tripId = trip.eventId;
    await database.db.insert(memberships).values({ commonsId: tripId, personId: member, role: "member", status: "active" });
    assert.equal((await readTripBudget(tripId, options)).version, 0);
    const first = await saveTripBudget(tripId, { expectedVersion: 0, inputs }, options);
    assert.deepEqual(first.inputs, inputs);
    assert.equal((await saveTripBudget(tripId, { expectedVersion: 0, inputs }, options)).version, 1, "uncertain response retry is idempotent");
    const partial = { ...inputs, nights: "not decided", activitiesTotal: ".", optional: [{ id: "extra-1", label: "Museum or garden?", perPerson: "TBD", participants: "" }] };
    await saveTripBudget(tripId, { expectedVersion: 1, inputs: partial }, options);
    assert.deepEqual((await readTripBudget(tripId, { ...options, actorPersonId: member })).inputs, partial);
    assert.equal((await readTripBudget(tripId, { ...options, actorPersonId: member })).canEdit, false);
    await assert.rejects(saveTripBudget(tripId, { expectedVersion: 2, inputs }, { ...options, actorPersonId: member }), CommandAccessError);
    await assert.rejects(readTripBudget(tripId, { ...options, actorPersonId: stranger }), CommandAccessError);
    await assert.rejects(saveTripBudget(tripId, { expectedVersion: 1, inputs }, options), CommandConflictError);
    await assert.rejects(saveTripBudget(tripId, { expectedVersion: 2, inputs: { ...inputs, privateAccount: "injected" } }, options));
    const outcomes = await Promise.allSettled([saveTripBudget(tripId, { expectedVersion: 2, inputs: { ...inputs, travelers: "9" } }, options), saveTripBudget(tripId, { expectedVersion: 2, inputs: { ...inputs, travelers: "10" } }, options)]);
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await database.db.select().from(expenses).where(eq(expenses.commonsId, tripId))).length, 0);
    await database.db.update(commons).set({ goingAt: new Date() }).where(eq(commons.id, tripId));
    assert.equal((await readTripBudget(tripId, options)).version, 3, "activation preserves the same worksheet");
    await database.db.update(memberships).set({ status: "removed" }).where(eq(memberships.personId, member));
    await assert.rejects(readTripBudget(tripId, { ...options, actorPersonId: member }), CommandAccessError);
  } finally {
    if (tripId) { await database.db.delete(tripBudgetWorksheets).where(eq(tripBudgetWorksheets.commonsId, tripId)); }
    await database.close();
  }
});
