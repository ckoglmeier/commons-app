import assert from "node:assert/strict";
import test from "node:test";
import { frozenWorkflowValidationCopy } from "../../../packages/database/src/workflow-saved-context";

test("source validators get isolated deeply frozen values, not mutable execution references", () => {
  const original = { pins: { version: "old" }, items: [{ value: "saved" }] };
  const copy = frozenWorkflowValidationCopy(original);
  assert.notEqual(copy, original); assert.notEqual(copy.items[0], original.items[0]);
  assert.throws(() => { copy.items[0].value = "forged"; }, TypeError);
  assert.throws(() => { copy.pins.version = "new"; }, TypeError);
  assert.throws(() => { copy.items.push({ value: "added" }); }, TypeError);
  assert.deepEqual(original, { pins: { version: "old" }, items: [{ value: "saved" }] });
});
