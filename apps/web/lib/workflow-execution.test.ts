import assert from "node:assert/strict";
import test from "node:test";
import { WorkflowPayloadSchema, WORKFLOW_EXECUTION_BYTES } from "@commons/contracts";

test("workflow payloads admit bounded plain JSON but reject cycles, executable values and oversized bodies", () => {
  const repeated = { text: "source" };
  assert.equal(WorkflowPayloadSchema.safeParse({ sources: [repeated, repeated], unknown: null }).success, true);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const value of [cycle, { fn: () => true }, { date: new Date() }, { number: Infinity }, { text: "x".repeat(WORKFLOW_EXECUTION_BYTES + 1) }, JSON.parse('{"__proto__":{"evil":true}}')])
    assert.equal(WorkflowPayloadSchema.safeParse(value).success, false);
});
