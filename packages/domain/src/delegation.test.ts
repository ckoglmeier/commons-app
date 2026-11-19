import assert from "node:assert/strict";
import test from "node:test";
import { ResearchDelegationRequestSchema, ResearchDelegationOutcomeSchema } from "@commons/contracts";

const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const request = {
  protocolVersion: 1, commandId: id, commonsId: id, threadId: id, parentTaskId: null,
  caller: { kind: "human", personId: id }, capability: "research.public_sources",
  input: { query: "Compare public museum opening hours" },
  routing: { kind: "commons_specialist" }, returnTo: { kind: "commons_thread", threadId: id },
};

test("delegation supports a personal agent without allowing arbitrary return URLs", () => {
  assert.ok(ResearchDelegationRequestSchema.safeParse(request).success);
  assert.ok(ResearchDelegationRequestSchema.safeParse({ ...request,
    caller: { kind: "agent", agentId: id, grantId: other },
    routing: { kind: "personal_agent", personId: id, agentId: other },
  }).success);
  assert.equal(ResearchDelegationRequestSchema.safeParse({ ...request,
    returnTo: { kind: "commons_thread", threadId: other },
  }).success, false);
  assert.equal(ResearchDelegationRequestSchema.safeParse({ ...request,
    returnTo: { kind: "webhook", url: "https://example.com" },
  }).success, false);
});

test("research requests cannot smuggle mutation authority or omit an agent grant", () => {
  for (const modified of [
    { ...request, capability: "booking.execute" },
    { ...request, approved: true },
    { ...request, input: { ...request.input, privateContext: "secret" } },
    { ...request, caller: { kind: "agent", agentId: id } },
  ]) assert.equal(ResearchDelegationRequestSchema.safeParse(modified).success, false);
});

test("successful execution returns source coverage separately from task completion", () => {
  const outcome = { taskId: id, attemptId: other, agentId: id, status: "succeeded",
    research: { query: "Museum hours", status: "partial", sources: [], limitations: ["No page could be read."] },
  };
  assert.ok(ResearchDelegationOutcomeSchema.safeParse(outcome).success);
  assert.equal(ResearchDelegationOutcomeSchema.safeParse({ ...outcome, research: undefined }).success, false);
  assert.equal(ResearchDelegationOutcomeSchema.safeParse({ ...outcome, applyToPlan: true }).success, false);
});
