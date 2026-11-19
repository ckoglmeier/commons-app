import { z } from "zod";
import type { PollAnswer, PollAudience, PollQuestion, PollWorkingData } from "./poll";
import type { DatesLocationConfiguration } from "./recipe-convergence";
import type { TripDatesLocation } from "./recipe";

export const MAX_RECIPE_ADVICE_ROUNDS = 20;
export type RecipeEvidenceSource = {
  pollId: string; round: number; fingerprint: string; status: "open" | "closed" | "revoked";
  ballotMode: "transparent" | "secret"; audience: PollAudience | null; superseded: boolean;
  questions: PollQuestion[];
  /** Hash of raw response identities/content, so hidden ballot changes still invalidate pending reviews. */
  responseFingerprint?: string;
  /** Guest identities are local to this response. Names never establish a cross-round identity. */
  responses: Array<{ responseId: string; personId: string | null; name: string; updatedAt: string; answers: PollAnswer[] }>;
  hiddenResponseCount: number;
  approvedOutcome: { id: string; status: string; alternativeId: string | null } | null;
  /** Server-derived only after an unchanged, candidate-bound approval. Never reused across candidates. */
  resolvedNeeds: Array<{ responseId: string; questionId: string; text: string }>;
};
export type RecipeEvidenceBundle = {
  runId: string; commonsId: string; fingerprint: string; complete: boolean;
  reviewedAlternativeId?: string;
  currentAudience: Array<{ personId: string; name: string; status: "active" | "invited" }>;
  trip: TripDatesLocation;
  draft: { id: string; version: number; published: boolean; questions: PollWorkingData["questions"] };
  sources: RecipeEvidenceSource[];
};
export type RecipeEvidenceReference = { pollId: string; questionId: string; optionId?: string; responseId?: string };
export type RecipeOptionEvidence = {
  optionId: string; label: string; dimension: "dates" | "location" | "combination";
  marker: { startsOn?: string; endsOn?: string; place?: string };
  markerFingerprint: string;
  yesPersonIds: string[]; maybePersonIds: string[]; noPersonIds: string[]; abstainedPersonIds: string[]; missingPersonIds: string[];
  unknownIdentityCount: number; preferenceScore: number; hasPreference: boolean;
  sources: RecipeEvidenceReference[];
  /** Universal fit is possible only for explicit combination feasibility with the entire current audience covered. */
  worksForEveryoneAsked: boolean;
};
export type RecipeAdvice = {
  version: 1; method: "rules"; evidenceFingerprint: string;
  action: "collect_existing" | "resolve_constraints" | "prepare_questions" | "review_outcome" | "supply_options";
  title: string; reason: string; stoppingCondition: string;
  facts: RecipeOptionEvidence[];
  unknowns: string[];
  constraints: Array<{ name: string; text: string; source: RecipeEvidenceReference }>;
  sourceFingerprints: Array<{ pollId: string; fingerprint: string }>;
  proposedConfiguration: DatesLocationConfiguration | null;
  estimatedDecisionsPerRespondent: number; estimatedTotalDecisions: number;
  suggestedAlternativeId: string | null;
};

/** The client selects a server-derived recommendation, never supplies a ballot or votes. */
export const AdoptRecipeAdviceSchema = z.object({
  commandId: z.string().uuid(), expectedDraftVersion: z.number().int().positive(),
  evidenceFingerprint: z.string().length(64), sourcePollIds: z.array(z.string().uuid()).max(MAX_RECIPE_ADVICE_ROUNDS),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.sourcePollIds).size !== value.sourcePollIds.length) ctx.addIssue({ code: "custom", message: "Each evidence source must be unique." });
});
