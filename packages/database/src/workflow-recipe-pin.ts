import { createHash } from "node:crypto";
import { WorkflowTemplateSchema, workflowDraftingContract, workflowReference, type WorkflowReference, type WorkflowTemplate } from "@commons/contracts";
import { CommandConflictError } from "./event-command";

/** Hash immutable definition fields only. Retirement/activation timestamps are
 * lifecycle metadata and must not change an in-flight recipe's identity.
 */
export function workflowTemplateDigest(template: WorkflowTemplate) {
  const value = WorkflowTemplateSchema.parse(template);
  return createHash("sha256").update(JSON.stringify({ id: value.id, key: value.key, version: value.version,
    title: value.title, description: value.description, purpose: value.purpose, instructions: value.instructions })).digest("hex");
}
export function pinnedWorkflowReference(template: WorkflowTemplate): WorkflowReference {
  return { ...workflowReference(template), execution: { contractVersion: 1, handler: workflowDraftingContract(template.purpose).handler,
    templateDigest: workflowTemplateDigest(template) } };
}
export function assertWorkflowRecipePin(template: WorkflowTemplate, reference: WorkflowReference) {
  if (template.id !== reference.id || template.key !== reference.key || template.version !== reference.version) throw new CommandConflictError();
  if (reference.execution) {
    const expected = pinnedWorkflowReference(template).execution!;
    if (expected.contractVersion !== reference.execution.contractVersion || expected.handler !== reference.execution.handler || expected.templateDigest !== reference.execution.templateDigest) throw new CommandConflictError();
  }
}
