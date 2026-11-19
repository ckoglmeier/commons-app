import assert from "node:assert/strict";
import test from "node:test";
import type { CommonsState } from "@commons/contracts";
import { eventConversation } from "./event-conversation";

const empty: CommonsState = { commonsId: "event", messages: [], proposals: [], itinerary: [], auditEvents: [], processedCommandIds: [], participation: {}, expenses: [], reimbursements: [], moments: [] };
const activity = { id: "one", title: "Lunch", startsAt: null, status: "planned" as const, participantScope: "everyone" as const, provenanceLabel: "Added by Jo" };
const audit = { id: "a", commandId: "c", actorId: "me", targetId: "one", occurredAt: "2026-09-11T10:00:00Z", action: "itinerary.added", summary: "PRIVATE CONFIRMATION" };

test("activity edits project one current card, without inventing messages or copying raw audit details", () => {
  const entries = eventConversation({ ...empty, itinerary: [{ ...activity, title: "Late lunch" }], auditEvents: [audit, { ...audit, id: "b", action: "itinerary.updated", occurredAt: "2026-09-11T11:00:00Z" }] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "activity");
  if (entries[0].kind === "activity") { assert.equal(entries[0].activity.title, "Late lunch"); assert.equal(entries[0].changed, true); }
  assert.doesNotMatch(JSON.stringify(entries), /PRIVATE CONFIRMATION/);
});
test("missing timestamps stay unknown and cancellation stays on the same activity", () => {
  const [entry] = eventConversation({ ...empty, itinerary: [{ ...activity, status: "cancelled" }] });
  assert.equal(entry.at, null);
  assert.equal(entry.id, "activity:one");
});
test("deleted activities deduplicate and private booking audit events stay out", () => {
  const entries = eventConversation({ ...empty, auditEvents: [{ ...audit, action: "itinerary.deleted" }, { ...audit, id: "b", action: "itinerary.deleted" }, { ...audit, id: "c", action: "travel_plan.saved" }] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "removed");
  assert.doesNotMatch(JSON.stringify(entries), /PRIVATE CONFIRMATION/);
});
test("human messages preserve original wording", () => {
  const message = { id: "m", actorId: "me", actorName: "Jo", actorType: "human" as const, body: "Moments and Photos are my words", occurredAt: audit.occurredAt, source: "web" as const };
  const [entry] = eventConversation({ ...empty, messages: [message] });
  assert.equal(entry.kind, "message");
  if (entry.kind === "message") assert.deepEqual(entry.message, message);
});

test("group messages on or off: paused messages leave the projection, receipts and decisions stay, stored messages are untouched", () => {
  const human = { id: "m", actorId: "me", actorName: "Jo", actorType: "human" as const, body: "Dinner at 7?", occurredAt: "2026-09-11T09:00:00Z", source: "web" as const };
  const commonsNote = { ...human, id: "c", actorId: "commons", actorName: "Commons", actorType: "commons" as const, body: "Dinner is on the plan." };
  const proposal = { id: "p", title: "Dinner", summary: "Thursday 7 PM", status: "approved", version: 1, createdAt: "2026-09-11T08:00:00Z", approvedAt: "2026-09-11T08:30:00Z", affectedPersonIds: [], evidence: [], payload: { kind: "shared_detail" } };
  const state = { ...empty, messages: [human, commonsNote], itinerary: [{ ...activity, title: "Late lunch" }], auditEvents: [audit, { ...audit, id: "gone", targetId: "removed", action: "itinerary.deleted", occurredAt: "2026-09-11T12:00:00Z" }], proposals: [proposal] } as unknown as CommonsState;
  const shown = eventConversation(state, { includeMessages: true }).map(entry => entry.kind).sort();
  assert.deepEqual(shown, ["activity", "message", "message", "proposal", "removed"]);
  const paused = eventConversation(state, { includeMessages: false });
  assert.deepEqual(paused.map(entry => entry.kind).sort(), ["activity", "proposal", "removed"], "activity receipts, decisions and removals remain");
  assert.equal(state.messages.length, 2, "records are preserved, only the projection changes");
  assert.deepEqual(eventConversation(state).map(entry => entry.kind).sort(), shown, "the projection default is unchanged for existing callers");
});
