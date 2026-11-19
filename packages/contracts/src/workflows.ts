import { z } from "zod";

// An authored recipe selects a supported handler. It is never executable code,
// a tool grant, an approval or a source of trip facts.
export const WorkflowPurposeSchema = z.enum(["trip_feasibility", "attendance_confirmation", "lodging_selection", "general_poll", "itinerary"]);
export const WorkflowKeySchema = z.string().regex(/^[a-z][a-z0-9_]{2,63}$/);
export const WorkflowDraftingPinSchema = z.object({
  contractVersion: z.literal(1),
  handler: z.enum(["poll_draft", "itinerary_draft"]),
  templateDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const WorkflowReferenceSchema = z.object({ id: z.string().uuid(), key: WorkflowKeySchema, version: z.number().int().positive(),
  execution: WorkflowDraftingPinSchema.optional(),
}).strict();
export const WorkflowDefinitionSchema = z.object({
  key: WorkflowKeySchema,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  purpose: WorkflowPurposeSchema,
  instructions: z.string().trim().min(20).max(12000),
}).strict();
export const WorkflowTemplateSchema = WorkflowDefinitionSchema.extend({
  id: z.string().uuid(), version: z.number().int().positive(),
  status: z.enum(["draft", "active", "retired"]),
  createdAt: z.string().datetime(),
});
export const SaveWorkflowVersionSchema = z.object({
  commandId: z.string().uuid(), expectedLatestVersion: z.number().int().nonnegative(), definition: WorkflowDefinitionSchema,
}).strict();
export const ActivateWorkflowVersionSchema = z.object({
  commandId: z.string().uuid(), id: z.string().uuid(), expectedActiveId: z.string().uuid().nullable(),
}).strict();
export type WorkflowPurpose = z.infer<typeof WorkflowPurposeSchema>;
export type WorkflowReference = z.infer<typeof WorkflowReferenceSchema>;
export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export function workflowReference(template: WorkflowTemplate): WorkflowReference {
  return { id: template.id, key: template.key, version: template.version };
}

/** The only allowed upgrade is adding a verified execution pin to a legacy
 * reference. Repositories resolve/validate that pin before committing it.
 */
export function workflowReferencePreserved(previous: WorkflowReference, next: WorkflowReference | undefined) {
  return Boolean(next && previous.id === next.id && previous.key === next.key && previous.version === next.version &&
    (!previous.execution || next.execution && previous.execution.contractVersion === next.execution.contractVersion &&
      previous.execution.handler === next.execution.handler && previous.execution.templateDigest === next.execution.templateDigest));
}

/** Code-owned metadata, not operator-editable execution or a permission grant.
 * Research is a separate authorized job; these recipes only draft artifacts.
 */
export function workflowDraftingContract(purpose: WorkflowPurpose) {
  WorkflowPurposeSchema.parse(purpose);
  const itinerary = purpose === "itinerary";
  const inputs = purpose === "trip_feasibility" ? ["trip_constraints", "supplied_alternatives"]
    : purpose === "attendance_confirmation" ? ["agreed_trip", "attendance_question"]
    : purpose === "lodging_selection" ? ["trip_constraints", "supplied_lodging_options"]
    : itinerary ? ["trip_constraints", "selected_commentary", "selected_evidence"] : ["organizer_question", "supplied_choices"];
  return { contractVersion: 1 as const, purpose, handler: itinerary ? "itinerary_draft" as const : "poll_draft" as const,
    outputSchema: itinerary ? "itinerary_content.v1" : "poll_working_data.v1", inputs,
    steps: ["permitted_context", "draft_generation", "validation", "human_review"], toolAdapterIds: [] as string[],
    providerDeadlineMs: itinerary ? 40_000 : null,
    authority: "private_draft_only" as const };
}
