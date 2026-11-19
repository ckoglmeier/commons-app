import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { createHookRenderer, registerComponentImportStubs, textOf } from "../lib/test-support/hook-harness";
import { pilotSnapshot } from "../lib/pilot-fixture";
registerComponentImportStubs();

for (const balancesDisabled of [true, false]) test(`activity conversion reviews the linked cost before recording (${balancesDisabled ? "family" : "allocated"})`, async () => {
  const { ExpenseEditorSheet } = await import("./commons-app");
  const participants = pilotSnapshot.participants.slice(0, 2);
  const plan = { ...pilotSnapshot.state.itinerary[0], id: "test-activity", title: "Balloon Fiesta", startsAt: "2026-10-09T13:00:00.000Z", scheduledDate: null, participantScope: "subgroup" as const, expectedParticipantIds: participants.map(person => person.id), participantIds: [], expectedCostCurrency: "EUR" };
  const saves: Array<Record<string, unknown>> = [];
  const renderer = createHookRenderer({ expand: [ExpenseEditorSheet] });
  try {
    renderer.render(createElement(ExpenseEditorSheet, { participants, itinerary: [plan], stays: [], travelPlans: [], balancesDisabled, timeZone: "America/Denver", currentActorId: participants[0].id, defaultDate: "2026-10-01", defaultCurrency: "USD", defaultPlan: plan, defaultPlanCostCents: 5000, startAsRecorded: true, close: () => {}, save: async value => { saves.push(value); } }));
    renderer.flush();
    assert.equal(saves.length, 0, "Opening conversion cannot save an expense");
    const amount = renderer.find(node => node.type === "input" && node.props["aria-label"] === "Expense amount in EUR");
    assert.equal(amount.props.value, "50.00");
    assert.equal(renderer.find(node => node.type === "button" && textOf(node) === "Recorded").props["aria-pressed"], true);
    assert.equal(renderer.findAll(node => node.type === "legend" && textOf(node) === "Should this create balances?").length, balancesDisabled ? 0 : 1);
    (renderer.find(node => node.type === "form").props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault() {} });
    await Promise.resolve();
    assert.equal(saves.length, 1);
    const saved = saves[0];
    assert.equal(saved?.currency, "EUR");
    assert.equal(saved?.amountCents, 5000);
    assert.equal(saved?.itineraryItemId, plan.id);
    assert.equal(saved?.occurredOn, "2026-10-09");
    assert.equal(saved?.paidByPersonId, participants[0].id);
    assert.equal(saved?.balanceMode, balancesDisabled ? "tracking_only" : "allocated");
    assert.deepEqual(saved?.shares, balancesDisabled ? [{ personId: participants[0].id, amountCents: 0 }] : participants.map(person => ({ personId: person.id, amountCents: 2500 })));
  } finally { renderer.unmount(); }
});
