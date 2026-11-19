import test from "node:test";
import assert from "node:assert/strict";
import { WorkflowReferenceSchema, workflowDraftingContract, workflowReference, workflowReferencePreserved } from "@commons/contracts";
import { assertWorkflowRecipePin, pinnedWorkflowReference, workflowTemplateDigest } from "@commons/database";
import { workflowEditorFixtures } from "./workflow-editor-fixture";
import { workflowGuidance } from "./server/workflow-guidance";

test("all five recipes select only supported code-owned draft contracts without tool authority", () => {
  for (const template of workflowEditorFixtures) {
    const contract = workflowDraftingContract(template.purpose), pin = pinnedWorkflowReference(template);
    assert.equal(contract.authority, "private_draft_only"); assert.deepEqual(contract.toolAdapterIds, []);
    assert.deepEqual(contract.steps, ["permitted_context", "draft_generation", "validation", "human_review"]);
    assert.equal(pin.execution?.handler, template.purpose === "itinerary" ? "itinerary_draft" : "poll_draft");
    assertWorkflowRecipePin(template, pin);
    assert.match(workflowGuidance(template), /Code-owned drafting contract v1/);
  }
  assert.throws(() => workflowDraftingContract("booking" as never));
  const contract = workflowDraftingContract("general_poll"); contract.toolAdapterIds.push("send");
  assert.deepEqual(workflowDraftingContract("general_poll").toolAdapterIds, [], "callers cannot mutate the registry");
});

test("recipe digest is stable across status and JSON ordering, but detects changed definition fields", () => {
  const template = workflowEditorFixtures[0], digest = workflowTemplateDigest(template);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(workflowTemplateDigest({ ...template, status: "retired", createdAt: "2026-10-04T12:00:00.000Z" }), digest);
  assert.equal(workflowTemplateDigest(Object.fromEntries(Object.entries(template).reverse()) as typeof template), digest);
  for (const changed of [{ ...template, instructions: template.instructions + " A revision." }, { ...template, title: "A different title" },
    { ...template, purpose: "itinerary" as const }, { ...template, version: 2 }]) assert.notEqual(workflowTemplateDigest(changed), digest);
});

test("legacy refs can gain verified pins; pinned refs cannot strip, switch or tamper with them", () => {
  const template = workflowEditorFixtures[0], legacy = workflowReference(template), pin = pinnedWorkflowReference(template);
  assertWorkflowRecipePin(template, legacy); assert.equal(workflowReferencePreserved(legacy, pin), true);
  assert.equal(workflowReferencePreserved(pin, legacy), false); assert.equal(workflowReferencePreserved(pin, undefined), false);
  assert.equal(workflowReferencePreserved(pin, { ...pin, version: 2 }), false);
  for (const execution of [{ ...pin.execution!, templateDigest: "f".repeat(64) }, { ...pin.execution!, handler: "itinerary_draft" as const }]) {
    assert.equal(workflowReferencePreserved(pin, { ...pin, execution }), false);
    assert.throws(() => assertWorkflowRecipePin(template, { ...pin, execution }));
  }
  assert.equal(WorkflowReferenceSchema.safeParse({ ...pin, execution: { ...pin.execution, tools: ["book"] } }).success, false);
  assert.equal(WorkflowReferenceSchema.safeParse({ ...pin, execution: { ...pin.execution, contractVersion: 2 } }).success, false);
  assert.throws(() => assertWorkflowRecipePin({ ...template, instructions: template.instructions + " changed" }, pin));
});
