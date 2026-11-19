import assert from "node:assert/strict";
import test from "node:test";
import { compactDigestActivities, compactDigestEvent } from "./conversation-digest-summary";

const at = (minute: number) => `2026-09-04T12:${String(minute).padStart(2, "0")}:00.000Z`;

test("collapses repeated writes to one resource into its final shared outcome", () => {
  const activities = compactDigestActivities([
    { action: "stay.added", resourceType: "stay", resourceId: "stay-1", summary: "Alex added Laguna House as a stay.", occurredAt: at(1) },
    { action: "stay.updated", resourceType: "stay", resourceId: "stay-1", summary: "Alex updated Laguna House.", occurredAt: at(2) },
    { action: "stay.updated", resourceType: "stay", resourceId: "stay-1", summary: "Alex updated Laguna House.", occurredAt: at(3) },
  ]);

  assert.equal(activities.length, 1);
  assert.equal(activities[0]?.summary, "Stay added: Laguna House.");
  assert.equal(activities[0]?.occurredAt, at(3));
});

test("omits resources added and removed in the same digest window", () => {
  const activities = compactDigestActivities([
    { action: "itinerary.added", resourceType: "itinerary_item", resourceId: "plan-1", summary: "Alex added Dinner.", occurredAt: at(1) },
    { action: "itinerary.deleted", resourceType: "itinerary_item", resourceId: "plan-1", summary: "Alex deleted Dinner.", occurredAt: at(2) },
  ]);
  assert.deepEqual(activities, []);
});

test("reports a removal when an existing resource is updated and deleted", () => {
  const activities = compactDigestActivities([
    { action: "expense.updated", resourceType: "expense", resourceId: "expense-1", summary: "Alex updated Flights.", occurredAt: at(1) },
    { action: "expense.deleted", resourceType: "expense", resourceId: "expense-1", summary: "Alex deleted Flights.", occurredAt: at(2) },
  ]);
  assert.equal(activities[0]?.summary, "Expense removed: Flights.");
});

test("deduplicates equivalent outcomes and puts cosmetic changes last", () => {
  const activities = compactDigestActivities([
    { action: "commons.cover_updated", resourceType: "commons", resourceId: "trip-1", summary: "Alex changed the trip cover.", occurredAt: at(4) },
    { action: "commons.cover_updated", resourceType: "commons", resourceId: "trip-1", summary: "Alex changed the trip cover.", occurredAt: at(5) },
    { action: "expense.deleted", resourceType: "expense", resourceId: "expense-1", summary: "Alex deleted Flights.", occurredAt: at(1) },
    { action: "expense.deleted", resourceType: "expense", resourceId: "expense-2", summary: "Alex deleted Flights.", occurredAt: at(2) },
    { action: "stay.updated", resourceType: "stay", resourceId: "stay-1", summary: "Alex updated Laguna House.", occurredAt: at(3) },
  ]);
  assert.deepEqual(activities.map((activity) => activity.summary), [
    "Stay updated: Laguna House.",
    "Expense removed: Flights.",
    "Trip cover changed.",
  ]);
});

test("reconciles expense cards with edits and removals from the same window", () => {
  const expense = (resourceId: string) => ({
    resourceId,
    title: "Flights",
    amountCents: 85000,
    currency: "USD",
    paidByName: "Alex",
    addedAt: at(1),
  });
  const compacted = compactDigestEvent([
    { action: "expense.updated", resourceType: "expense", resourceId: "expense-1", summary: "Alex updated Flights.", occurredAt: at(2) },
    { action: "expense.deleted", resourceType: "expense", resourceId: "expense-2", summary: "Alex deleted Flights.", occurredAt: at(3) },
  ], [expense("expense-1"), expense("expense-2"), expense("expense-3")]);

  assert.deepEqual(compacted.activities, []);
  assert.equal(compacted.expenses.length, 1, "matching round-trip records render once and a deleted new record disappears");
  assert.equal(compacted.expenses[0]?.resourceId, "expense-3");
});
