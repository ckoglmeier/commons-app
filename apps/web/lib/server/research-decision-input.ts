import { z } from "zod";
import { ResearchDecisionBriefSchema, type ResearchDecisionBrief, type TripContextSnapshot, type WorkflowJson } from "@commons/contracts";
import type { WorkflowSavedContext, WorkflowValidationScope } from "@commons/database";
import {
  ResearchContextSelectionSchema, SavedWineryDecisionRequestSchema, SavedTransportDecisionRequestSchema,
  projectResearchDecisionContext, buildSavedWineryDecision, buildSavedTransportDecision,
  type ResearchContextSelection, type ResearchDecisionContextProjection,
} from "./research-decision-context";

// Runtime identities/pins are never domain input. The common binder supplies them.
export const ResearchDecisionPlanSchema = z.object(ResearchDecisionBriefSchema.shape).omit({
  taskId: true, threadId: true, ownerId: true, revision: true, contextRevision: true, recipe: true,
}).strict();
const FixtureInputSchema = z.object({ schemaVersion: z.literal(1), plan: ResearchDecisionPlanSchema }).strict();
export const SavedResearchDecisionRequestSchema = z.discriminatedUnion("kind", [
  SavedWineryDecisionRequestSchema.extend({ kind: z.literal("winery") }).strict(),
  SavedTransportDecisionRequestSchema.extend({ kind: z.literal("transport") }).strict(),
]);
export const SavedResearchDecisionInputSchema = z.object({
  schemaVersion: z.literal(2), plan: ResearchDecisionPlanSchema,
  savedContext: z.object({ selection: ResearchContextSelectionSchema,
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/), request: SavedResearchDecisionRequestSchema }).strict(),
}).strict();
export const ResearchDecisionInputSchema = z.discriminatedUnion("schemaVersion", [FixtureInputSchema, SavedResearchDecisionInputSchema]);
export type ResearchDecisionInput = z.infer<typeof ResearchDecisionInputSchema>;
export type SavedResearchDecisionRequest = z.infer<typeof SavedResearchDecisionRequestSchema>;

const planOf = (brief: ResearchDecisionBrief) => ResearchDecisionPlanSchema.parse(Object.fromEntries(Object.entries(brief)
  .filter(([key]) => !["taskId", "threadId", "ownerId", "revision", "contextRevision", "recipe"].includes(key))));
/** Legacy synthetic fixture input. Not eligible for public-reference execution. */
export function researchDecisionInput(brief: ResearchDecisionBrief): z.infer<typeof FixtureInputSchema> {
  return FixtureInputSchema.parse({ schemaVersion: 1, plan: planOf(ResearchDecisionBriefSchema.parse(brief)) });
}
function rebuild(projection: ResearchDecisionContextProjection, request: SavedResearchDecisionRequest) {
  // Remove the discriminator before parsing strict, recipe-specific requests.
  if (request.kind === "winery") {
    return planOf(buildSavedWineryDecision(projection, { title: request.title, queries: request.queries, nominated: request.nominated, visitDate: request.visitDate }));
  }
  return planOf(buildSavedTransportDecision(projection, { title: request.title, queries: request.queries, stayRef: request.stayRef,
    arrivalRef: request.arrivalRef, departureRef: request.departureRef, wineryDate: request.wineryDate, answers: request.answers }));
}
/** SERVER preparation only. The selection and request must come from a reviewed
 * common command, not raw model/chat/browser intent. This payload is NOT an
 * approval receipt, query-privacy approval, or authorization token. No endpoint or
 * production handler registers it yet. Binding must rebuild it atomically.
 */
export function savedResearchDecisionInput(projection: ResearchDecisionContextProjection, selection: ResearchContextSelection, request: SavedResearchDecisionRequest) {
  const parsed = SavedResearchDecisionRequestSchema.parse(request);
  return SavedResearchDecisionInputSchema.parse({ schemaVersion: 2, plan: rebuild(projection, parsed),
    savedContext: { selection, sourceFingerprint: projection.sourceFingerprint, request: parsed } });
}
/** Syntax and cross-field validation only. Saved source validation is a separate
 * mandatory shared-transaction predicate for any saved-context handler.
 */
export function validResearchDecisionInput(value: Record<string, WorkflowJson>, scope?: WorkflowValidationScope): boolean {
  const input = ResearchDecisionInputSchema.safeParse(value);
  if (!input.success || input.data.schemaVersion === 2 && input.data.savedContext.request.kind !== input.data.plan.kind) return false;
  if (scope && (scope.pins.recipe.key !== `${input.data.plan.kind}-decision-v1` || scope.pins.recipe.version !== 1)) return false;
  const uuid = "00000000-0000-4000-8000-000000000001";
  return ResearchDecisionBriefSchema.safeParse({ ...input.data.plan, taskId: uuid, threadId: uuid, ownerId: uuid,
    revision: 1, contextRevision: "validation-only", recipe: { key: `${input.data.plan.kind}-decision-v1`, version: 1 } }).success;
}
/** Code-owned synchronous predicate for the common atomic context-validation seam.
 * No SQL/write handle, I/O, paid call or model judgment. The snapshot and scope
 * MUST come from the runtime's authorized transaction, includeOwnTravel:false.
 * A self-consistent forged payload is not proof of organizer approval; the host
 * still needs its reviewed-command/receipt integration before live activation.
 */
export function validSavedResearchDecisionContext(value: Readonly<Record<string, WorkflowJson>>, scope: Readonly<WorkflowValidationScope>, context: Readonly<WorkflowSavedContext> | TripContextSnapshot): boolean {
  try {
    const input = SavedResearchDecisionInputSchema.parse(value);
    if (!validResearchDecisionInput(value, scope)) return false;
    const projection = projectResearchDecisionContext(context, scope, input.savedContext.selection);
    if (projection.sourceFingerprint !== input.savedContext.sourceFingerprint) return false;
    // Schema parsing canonicalizes object keys (JSONB may reorder them). Arrays,
    // references, unknowns and every derived field are still compared exactly.
    return JSON.stringify(rebuild(projection, input.savedContext.request)) === JSON.stringify(input.plan);
  } catch { return false; }
}
