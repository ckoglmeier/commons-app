import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { commons, expenses, expenseShares, memberships, reimbursements } from "@commons/database";
import { actAs, and, databaseTestsEnabled, eq, seedSyntheticTrip, withTestDatabase } from "../test-support/database-harness";
import { registerComponentImportStubs } from "../test-support/hook-harness";

test("summary loading enforces active membership and projects family/private fields", { skip: !databaseTestsEnabled }, async () => {
  registerComponentImportStubs();
  const { loadMoneySummary } = await import("./money-summary");
  const { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } = await import("./commons-access-errors");
  const environment = { ...process.env };
  const trip = await seedSyntheticTrip(), otherTrip = await seedSyntheticTrip();
  try {
    const expenseId = randomUUID();
    await withTestDatabase(async db => {
      await db.insert(expenses).values({ id: expenseId, commonsId: trip.eventId, title: "Synthetic dinner", amountCents: 10001, paidByPersonId: trip.organizerId, occurredOn: "2027-02-12", category: "food", status: "confirmed", splitMethod: "exact", balanceMode: "allocated", source: "web", sourceLabel: "Synthetic", confirmationCode: "private-code", note: "private-note" });
      await db.insert(expenseShares).values([{ expenseId, personId: trip.organizerId, amountCents: 5001 }, { expenseId, personId: trip.travelerId, amountCents: 5000 }]);
      await db.insert(reimbursements).values({ commonsId: trip.eventId, fromPersonId: trip.travelerId, toPersonId: trip.organizerId, amountCents: 1234, occurredOn: "2027-02-12", source: "web", sourceLabel: "Synthetic" });
    });
    for (const personId of [trip.organizerId, trip.travelerId]) {
      actAs(personId);
      const report = await loadMoneySummary(trip.eventId);
      assert.equal(report?.viewer?.personId, personId);
      assert.equal(report?.currencies[0].recordedCents, 10001);
      assert.equal(report?.currencies[0].balances.find(balance => balance.personId === trip.organizerId)?.netCents, 3766);
      assert.doesNotMatch(JSON.stringify(report), /private-code|private-note|Synthetic Peak Lodge/);
    }
    // A shared link is a fresh read, not a snapshot minted when the organizer copies it.
    await withTestDatabase(db => db.update(reimbursements).set({ amountCents: 2234 }).where(eq(reimbursements.commonsId, trip.eventId)));
    const refreshed = await loadMoneySummary(trip.eventId);
    assert.equal(refreshed?.viewer?.personId, trip.travelerId);
    assert.equal(refreshed?.currencies[0].balances.find(balance => balance.personId === trip.travelerId)?.netCents, -2766);
    await withTestDatabase(db => db.update(commons).set({ balancesDisabled: true }).where(eq(commons.id, trip.eventId)));
    const family = await loadMoneySummary(trip.eventId);
    assert.equal(family?.viewer, null);
    assert.deepEqual(family?.currencies[0].payments, []);
    assert.deepEqual(family?.currencies[0].balances, []);
    assert.deepEqual(family?.currencies[0].expenses[0].shares, []);
    for (const status of ["invited", "removed"] as const) {
      await withTestDatabase(db => db.update(memberships).set({ status }).where(and(eq(memberships.commonsId, trip.eventId), eq(memberships.personId, trip.travelerId))));
      await assert.rejects(loadMoneySummary(trip.eventId), CommonsMembershipRequiredError);
    }
    actAs(otherTrip.organizerId);
    await assert.rejects(loadMoneySummary(trip.eventId), CommonsMembershipRequiredError);
    delete process.env.COMMONS_PILOT_ACTOR_ID;
    await assert.rejects(loadMoneySummary(trip.eventId), CommonsAuthenticationRequiredError);
    const sample = await loadMoneySummary("10000000-0000-4000-8000-000000000001");
    assert.equal(sample?.sample, true);
    assert.equal(sample?.viewer, null);
  } finally {
    await trip.cleanup(); await otherTrip.cleanup();
    for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
    Object.assign(process.env, environment);
  }
});
