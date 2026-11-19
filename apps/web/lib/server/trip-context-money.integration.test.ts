import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { commons, memberships, auditEvents, addCommonsItineraryItem, addCommonsExpense, updateCommonsExpense, addCommonsReimbursement, updateCommonsReimbursement, updateCommonsTargetBudget, loadCoordinatorTripContext } from "@commons/database";
import { actAs, and, databaseTestsEnabled, eq, params, seedSyntheticTrip, testDatabaseUrl, withTestDatabase } from "./coordinator-route-harness";
import { registerComponentImportStubs } from "../test-support/hook-harness";
import { renderTripContextForModel } from "./coordinator-context-prompt";
const restore = (environment: NodeJS.ProcessEnv) => { for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key]; Object.assign(process.env, environment); };

test("context preserves setup, protects co-organizer edits/replays and feeds only permitted model fields", { skip: !databaseTestsEnabled }, async () => {
  registerComponentImportStubs();
  const route = await import("../../app/api/v1/commons/[slug]/context/route");
  const environment = { ...process.env }, trip = await seedSyntheticTrip(), other = await seedSyntheticTrip();
  const call = (input?: object) => route[input ? "PATCH" : "GET"](new Request("http://localhost/context", { method: input ? "PATCH" : "GET", ...(input ? { body: JSON.stringify(input) } : {}) }), params(trip.eventId));
  try {
    await withTestDatabase(db => db.update(commons).set({ eventBrief: { summary: "Reconnecting", goals: ["Good food"], suggestedFirstMoves: ["Choose dates"], hiddenLegacyField: "NEVER_PASS_TO_MODEL" } }).where(eq(commons.id, trip.eventId)));
    actAs(trip.organizerId);
    let result = await (await call()).json();
    assert.equal(result.brief.summary, "Reconnecting"); assert.equal(result.version, 0);
    assert.doesNotMatch(JSON.stringify(result), /NEVER_PASS_TO_MODEL|suggestedFirstMoves/);
    const command = { commandId: randomUUID(), expectedVersion: 0, brief: { ...result.brief, pace: "One outing a day", goals: ["Quiet afternoons"], budgetMinimumCents: 100000, budgetMaximumCents: 200000, currency: "EUR" } };
    const response = await call(command); assert.equal(response.status, 200); result = await response.json();
    assert.equal(result.version, 1); assert.equal(result.updatedByName, "Casey Synthetic");
    assert.deepEqual(await (await call(command)).json(), result);
    assert.equal((await call({ ...command, brief: { ...command.brief, pace: "Rushed" } })).status, 409);
    actAs(trip.coOrganizerId);
    assert.equal((await call({ ...command, commandId: randomUUID() })).status, 409);
    assert.equal((await call({ ...command, commandId: randomUUID(), expectedVersion: 1, brief: { ...command.brief, pace: "Slow mornings" } })).status, 200);
    const context = await loadCoordinatorTripContext(trip.eventId, { databaseUrl: testDatabaseUrl(), actorPersonId: trip.organizerId });
    const rendered = JSON.parse(renderTripContextForModel(context, { maxChars: 18000 }).json);
    assert.equal(rendered.trip.planningPreferences.pace, "Slow mornings");
    assert.equal(rendered.trip.planningPreferences.budgetMaximumCents, 200000);
    assert.doesNotMatch(JSON.stringify(context), /NEVER_PASS_TO_MODEL|suggestedFirstMoves/);
    await withTestDatabase(async db => {
      const [row] = await db.select().from(commons).where(eq(commons.id, trip.eventId));
      assert.equal(row.eventBrief?.hiddenLegacyField, "NEVER_PASS_TO_MODEL"); assert.deepEqual(row.eventBrief?.suggestedFirstMoves, ["Choose dates"]); assert.equal(row.targetBudgetCents, null);
      const receipts = await db.select().from(auditEvents).where(and(eq(auditEvents.commonsId, trip.eventId), eq(auditEvents.action, "trip.context.saved"))); assert.equal(receipts.length, 2);
    });
    for (const person of [trip.travelerId, other.organizerId]) { actAs(person); assert.equal((await call()).status, 403); assert.equal((await call(command)).status, 403); }
    await withTestDatabase(db => db.update(memberships).set({ status: "removed" }).where(and(eq(memberships.commonsId, trip.eventId), eq(memberships.personId, trip.organizerId))));
    actAs(trip.organizerId); assert.equal((await call(command)).status, 403);
    delete process.env.COMMONS_PILOT_ACTOR_ID; assert.equal((await call()).status, 401);
  } finally { await trip.cleanup(); await other.cleanup(); restore(environment); }
});

test("trip currency changes preserve records; old edits retain currency and members cannot change defaults", { skip: !databaseTestsEnabled }, async () => {
  registerComponentImportStubs(); const route = await import("../../app/api/v1/commons/[slug]/money-settings/route");
  const environment = { ...process.env }, trip = await seedSyntheticTrip(), options = { databaseUrl: testDatabaseUrl(), actorPersonId: trip.organizerId };
  const call = (input: object) => route.PATCH(new Request("http://localhost/money-settings", { method: "PATCH", body: JSON.stringify(input) }), params(trip.eventId));
  try {
    actAs(trip.organizerId);
    await updateCommonsTargetBudget(trip.eventId, { commandId: randomUUID(), amountCents: 500000 }, options);
    const expense = { commandId: randomUUID(), title: "Dinner", amountCents: 10001, currency: "EUR", paidByPersonId: trip.organizerId, occurredOn: "2027-02-12", category: "Food", splitMethod: "exact", balanceMode: "allocated", shares: [{ personId: trip.organizerId, amountCents: 5001 }, { personId: trip.travelerId, amountCents: 5000 }] };
    let snapshot = await addCommonsExpense(`qa-${trip.eventId}`, expense, options); const id = snapshot!.state.expenses.find(row => row.title === "Dinner")!.id;
    const payment = { commandId: randomUUID(), currency: "EUR", fromPersonId: trip.travelerId, toPersonId: trip.organizerId, amountCents: 1234, occurredOn: "2027-02-12" };
    snapshot = await addCommonsReimbursement(`qa-${trip.eventId}`, payment, options); const paymentId = snapshot!.state.reimbursements[0].id;
    const change = { commandId: randomUUID(), currency: "EUR", expectedCurrency: "USD", balancesDisabled: false, expectedBalancesDisabled: false };
    let response = await call(change); assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.snapshot.commons.currency, "EUR"); assert.equal(body.snapshot.state.targetBudgetCurrency, "USD"); assert.equal(body.snapshot.state.targetBudgetCents, 500000);
    assert.equal(body.snapshot.state.expenses[0].currency, "EUR"); assert.equal(body.snapshot.state.expenses[0].amountCents, 10001);
    assert.equal((await call(change)).status, 200); assert.equal((await call({ ...change, commandId: randomUUID(), currency: "GBP" })).status, 409);
    snapshot = await updateCommonsExpense(`qa-${trip.eventId}`, id, { ...expense, currency: undefined, commandId: randomUUID(), title: "Dinner updated" }, options); assert.equal(snapshot!.state.expenses[0].currency, "EUR");
    snapshot = await updateCommonsReimbursement(`qa-${trip.eventId}`, paymentId, { ...payment, currency: undefined, commandId: randomUUID(), amountCents: 2234 }, options); assert.equal(snapshot!.state.reimbursements[0].currency, "EUR");
    await assert.rejects(updateCommonsExpense(`qa-${trip.eventId}`, id, { ...expense, commandId: randomUUID(), currency: "USD" }, options), /saved currency cannot be changed/);
    await assert.rejects(updateCommonsReimbursement(`qa-${trip.eventId}`, paymentId, { ...payment, commandId: randomUUID(), currency: "USD" }, options), /saved currency cannot be changed/);
    await addCommonsExpense(`qa-${trip.eventId}`, { ...expense, currency: "USD", commandId: randomUUID(), title: "Explicit USD" }, options);
    const context = await loadCoordinatorTripContext(trip.eventId, options);
    assert.equal(context.trip.value.currency, "EUR");
    assert.equal(context.budget.value.recordedExpenseTotalCents, 10001); assert.equal(context.budget.value.currency, "USD");
    assert.deepEqual(context.budget.value.recordedByCurrency, [{ currency: "EUR", totalCents: 10001, count: 1 }, { currency: "USD", totalCents: 10001, count: 1 }]);
    snapshot = await addCommonsExpense(`qa-${trip.eventId}`, { ...expense, currency: undefined, commandId: randomUUID(), title: "Uses trip currency" }, options);
    assert.equal(snapshot!.state.expenses.find(row => row.title === "Uses trip currency")!.currency, "EUR");
    snapshot = await addCommonsReimbursement(`qa-${trip.eventId}`, { ...payment, currency: undefined, commandId: randomUUID(), amountCents: 777 }, options);
    assert.equal(snapshot!.state.reimbursements.find(row => row.amountCents === 777)!.currency, "EUR");
    snapshot = await addCommonsItineraryItem(`qa-${trip.eventId}`, { commandId: randomUUID(), title: "Default currency activity", date: null, time: null, participantScope: "everyone", expectedCostCents: 1200, occurredAt: new Date().toISOString() }, options);
    assert.equal(snapshot!.state.itinerary.find(row => row.title === "Default currency activity")!.expectedCostCurrency, "EUR");
    actAs(trip.travelerId); response = await call({ ...change, commandId: randomUUID(), expectedCurrency: "EUR", currency: "GBP" }); assert.equal(response.status, 403);
    delete process.env.COMMONS_PILOT_ACTOR_ID; assert.equal((await call(change)).status, 401);
  } finally { await trip.cleanup(); restore(environment); }
});
