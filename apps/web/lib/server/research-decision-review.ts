import { createHash } from "node:crypto";
import { z } from "zod";
import type { TripContextSnapshot, WorkflowJson } from "@commons/contracts";
import type { WorkflowValidationScope } from "@commons/database";
import { ResearchContextSelectionSchema, projectResearchDecisionContext } from "./research-decision-context";
import { SavedResearchDecisionRequestSchema, SavedResearchDecisionInputSchema, savedResearchDecisionInput, validSavedResearchDecisionContext } from "./research-decision-input";
import { isInternalLookup, isPersonContactLookup, sanitizeTypedResearchQuery } from "./coordinator-research-query";

/** Browser-editable choices only. The host owns authentication, canonical scope,
 * fresh saved context, the durable common command and its approval receipt.
 * No snapshot, derived party, authority, budget or model fields are accepted.
 */
export const ResearchDecisionReviewRequestSchema = z.object({
  selection: ResearchContextSelectionSchema,
  request: SavedResearchDecisionRequestSchema,
}).strict();

export class ResearchDecisionReviewConflict extends Error {
  constructor(readonly reason: "public_query_needs_review" | "no_public_queries") {
    super(reason); this.name = "ResearchDecisionReviewConflict";
  }
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalized = (value: string) => value.normalize("NFKC").toLowerCase();
const month = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const spelledDate = new RegExp(`\\b(?:${month}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}(?:st|nd|rd|th)?\\s+${month})\\b`, "i");

/** Exact reviewed public query or a hold, never a silently rewritten search.
 * Reuse the shared filter, then conservatively exclude known roster name parts
 * and internal/person-contact lookups. This is a bounded deterministic guard,
 * not a claim of comprehensive semantic DLP or permission to dispatch a tool.
 */
export function reviewedResearchPublicQuery(query: string, context: TripContextSnapshot): string | null {
  const checked = sanitizeTypedResearchQuery(query, context);
  if (!checked || checked.changed || checked.query !== query || isInternalLookup(query, context) || isPersonContactLookup(query, context)) return null;
  const value = normalized(query);
  const names = context.travelers.flatMap(fact => [fact.value.name, ...fact.value.name.split(/[^\p{L}\p{N}]+/u)])
    .map(normalized).filter(name => name.length >= 2);
  if (names.some(name => new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, "u").test(value))) return null;
  // The shared query guard covers numeric dates and codes. Spellings such as
  // "November 5" and exact clocks also identify the group's itinerary.
  if (spelledDate.test(query) || /\b\d{1,2}:\d{2}\b|\b\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?\b/i.test(query)) return null;
  return query;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
/** Code-owned content binding for a future common reviewed command. A digest is
 * NOT an approval token: anyone can calculate it. Only the common host can
 * establish its durable human-command provenance and current state atomically.
 */
export function researchDecisionReviewFingerprint(input: unknown, scope: WorkflowValidationScope): string {
  const parsed = SavedResearchDecisionInputSchema.parse(input);
  return createHash("sha256").update(JSON.stringify(canonical({
    action: "reviewed-research-decision-v1", input: parsed,
    tripId: scope.tripId, actorId: scope.actorId, threadId: scope.threadId, taskId: scope.taskId,
    artifactId: scope.artifactId, pins: scope.pins,
  }))).digest("hex");
}

/** Pure server preparation, still unregistered. Call only with a host-authorized
 * snapshot/scope. The return value can be reviewed but cannot start a goal, bind
 * a worker, reserve spend, publish, book, or approve itself.
 */
export function prepareResearchDecisionReview(raw: unknown, context: TripContextSnapshot, scope: WorkflowValidationScope) {
  const { selection, request } = ResearchDecisionReviewRequestSchema.parse(raw);
  if (!request.queries.length) throw new ResearchDecisionReviewConflict("no_public_queries");
  for (const query of request.queries) if (reviewedResearchPublicQuery(query.text, context) !== query.text)
    throw new ResearchDecisionReviewConflict("public_query_needs_review");
  const projection = projectResearchDecisionContext(context, scope, selection);
  const input = savedResearchDecisionInput(projection, selection, request);
  return { input, fingerprint: researchDecisionReviewFingerprint(input, scope) };
}

/** Dispatch-time domain check for a host's publicQuery port. The host must supply
 * a fresh authorized full context for privacy, not the minimized source callback
 * or a client snapshot. Its durable reviewed-command gate remains mandatory.
 * This pure check is not an atomic approval or name-change fence on its own.
 */
export function researchDecisionQueryFromCurrentContext(query: string, input: Record<string, WorkflowJson>, context: TripContextSnapshot, scope: WorkflowValidationScope): string | null {
  const parsed = SavedResearchDecisionInputSchema.safeParse(input);
  if (!parsed.success || !parsed.data.plan.queries.some(item => item.text === query)
    || !validSavedResearchDecisionContext(input, scope, context)) return null;
  return reviewedResearchPublicQuery(query, context);
}
