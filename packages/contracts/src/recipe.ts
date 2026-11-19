import { z } from "zod";
import { formatAlternativeLabel } from "./poll-availability";
import { formatPollSchedule } from "./poll-availability";
import { DatesLocationConfigurationSchema, MAX_RECIPE_COMBINATIONS, type DatesLocationConfiguration } from "./recipe-convergence";
export * from "./recipe-convergence";
import { type PollOption, type PollQuestion, type PollWorkingData } from "./poll";

/**
 * Recipes are the user-facing name for a guided planning lifecycle:
 * understand → draft → share → collect → decide → reuse.
 *
 * A recipe is configuration plus code-owned handlers. It never grants a tool,
 * an approval or authority to change trip records. The stable internal
 * workflow keys below are what admin-authored recipe versions are stored under.
 */
export const RecipeIdSchema = z.enum(["dates_location", "attendance", "lodging", "food_preferences", "transport", "itinerary", "custom_poll"]);
export type RecipeId = z.infer<typeof RecipeIdSchema>;

export type RecipeCatalogEntry = {
  id: RecipeId; title: string; summary: string;
  /** Internal workflow identifier; unchanged so existing pinned drafts stay valid. */
  workflowKey: string;
  handler: "poll_draft" | "itinerary_draft" | "transport_coordination";
  /** `guided` has a structured lifecycle in this release; `review` reads existing records and proposes without publishing; `conversation` still starts from the coordinator. */
  lifecycle: "guided" | "review" | "conversation";
};

export const recipeCatalog: readonly RecipeCatalogEntry[] = [
  { id: "dates_location", title: "Pick a date and location", summary: "Compare a few specific date-and-place options and see what works for everyone who answered.", workflowKey: "trip_feasibility", handler: "poll_draft", lifecycle: "guided" },
  { id: "attendance", title: "Confirm who is coming", summary: "Ask for a clear in, maybe or out once dates and location are settled.", workflowKey: "attendance_confirmation", handler: "poll_draft", lifecycle: "conversation" },
  { id: "lodging", title: "Find a place to stay", summary: "Compare the stays you supply, with the room needs people state.", workflowKey: "lodging_selection", handler: "poll_draft", lifecycle: "conversation" },
  { id: "food_preferences", title: "Collect food preferences", summary: "Gather dietary requirements and preferences to help plan meals.", workflowKey: "general_poll", handler: "poll_draft", lifecycle: "guided" },
  { id: "transport", title: "Coordinate transport", summary: "Suggest shared rides from flights people have added.", workflowKey: "transport_coordination", handler: "transport_coordination", lifecycle: "review" },
  { id: "itinerary", title: "Shape the itinerary", summary: "Draft a plan, collect comments and share it for feedback.", workflowKey: "itinerary", handler: "itinerary_draft", lifecycle: "conversation" },
  { id: "custom_poll", title: "Ask the group", summary: "Ask anything else, with your own questions and choices.", workflowKey: "general_poll", handler: "poll_draft", lifecycle: "conversation" },
] as const;

export function recipeEntry(id: RecipeId) { return recipeCatalog.find(entry => entry.id === id)!; }
export function recipeForWorkflowKey(key: string) { return recipeCatalog.find(entry => entry.workflowKey === key && entry.id !== "food_preferences") ?? null; }

/** Display stages are derived from the draft, the published round, the decision and the outcome. They are never stored. */
export const RecipeStageSchema = z.enum(["draft", "shared", "collecting", "decide", "decided", "applied", "closed"]);
export type RecipeStage = z.infer<typeof RecipeStageSchema>;
export const recipeStageLabels: Record<RecipeStage, string> = {
  draft: "Drafting", shared: "Shared, no answers yet", collecting: "Collecting answers", decide: "Ready to decide",
  decided: "Result recorded", applied: "Applied to the trip", closed: "Closed",
};

export type RecipeStageFacts = {
  draft: { archived: boolean; publishedPollId: string | null } | null;
  poll: { status: "open" | "closed" | "revoked"; responseCount: number; superseded: boolean } | null;
  outcome: { status: "approved" | "applied" | "superseded" } | null;
};

export function deriveRecipeStage(facts: RecipeStageFacts): RecipeStage {
  const { draft, poll, outcome } = facts;
  if (outcome?.status === "applied") return "applied";
  if (outcome?.status === "approved") return "decided";
  if (poll) {
    if (poll.superseded || poll.status === "revoked") return "closed";
    if (poll.status === "closed") return "decide";
    return poll.responseCount > 0 ? "collecting" : "shared";
  }
  if (draft?.archived) return "closed";
  return "draft";
}

/* ---------- Date and location alternatives ---------- */

export const DatesLocationAlternativeSchema = z.object({
  id: z.string().uuid(),
  startsOn: z.iso.date({ message: "Add a valid start date." }),
  endsOn: z.iso.date({ message: "Add a valid end date." }),
  place: z.string().trim().min(1, "Add a place for each option.").max(60, "Keep each place under 60 characters."),
}).strict().refine(value => value.endsOn >= value.startsOn, { message: "The end date must be on or after the start date.", path: ["endsOn"] });
export { formatAlternativeLabel };
export type DatesLocationAlternative = z.infer<typeof DatesLocationAlternativeSchema>;

export const DatesLocationAlternativesSchema = z.array(DatesLocationAlternativeSchema).min(2, "Add at least two options to compare.").max(MAX_RECIPE_COMBINATIONS, "Compare at most ten options.")
  .superRefine((alternatives, ctx) => {
    const keys = alternatives.map(item => `${item.startsOn}|${item.endsOn}|${item.place.toLocaleLowerCase()}`);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Each date-and-place option must be different." });
    if (new Set(alternatives.map(item => item.id)).size !== alternatives.length) ctx.addIssue({ code: "custom", message: "Each option needs its own identifier." });
  });

export const NEITHER_LABEL = "None of these work for me";
const ACCEPTABLE_PROMPT = "Which of these could you do? Select every option that works for you.";
const PREFERRED_PROMPT = "If you could only pick one, which would you prefer?";

/** The two questions that carry date-and-place alternatives. */
export function datesLocationQuestions(questions: PollQuestion[]) {
  const withAlternatives = questions.flatMap(question => question.kind === "choice" && question.options.some(option => option.alternative) ? [question] : []);
  const acceptable = withAlternatives.find(question => question.selectionMode === "multiple");
  const preferred = withAlternatives.find(question => question.selectionMode === "single");
  return acceptable ? { acceptable, preferred: preferred ?? null } : null;
}

function alternativeOption(alternative: DatesLocationAlternative): PollOption {
  return { id: alternative.id, label: formatAlternativeLabel(alternative), description: null, exclusive: false,
    alternative: { startsOn: alternative.startsOn, endsOn: alternative.endsOn, place: alternative.place } };
}

/**
 * Deterministic poll for a date-and-place choice. Suitability depends on the
 * combination, so each option is one date range at one place; the group never
 * votes on dates and places separately and no combination is inferred.
 * Option ids are the alternative ids in both questions, so "works for me" and
 * "prefer" answers refer to the same typed alternative.
 */
export function buildDatesLocationPollData(input: { alternatives?: DatesLocationAlternative[]; configuration?: DatesLocationConfiguration; title?: string; previous?: Pick<PollWorkingData, "questions"> | null }): PollWorkingData {
  if (input.configuration) {
    if (input.alternatives) throw new Error("Choose legacy alternatives or selectable questions, not both.");
    const supplied = DatesLocationConfigurationSchema.parse(input.configuration);
    const configuration: DatesLocationConfiguration = { ...supplied, blocks: supplied.blocks.map(block => {
      const previous = input.previous?.questions.find(question => question.id === block.id);
      if (!previous) return block;
      const expectedKind = block.type === "text" ? "text" : block.type === "choice" || block.type === "combination" ? "choice" : block.type === "ranking" || block.type === "allocation" ? block.type : "option_response";
      const dimension = block.type === "ranking" || block.type === "allocation" ? block.dimension : block.type;
      const scale = block.type === "dates" ? "yes_maybe_no" : block.scale ?? "interest";
      const changedFormat = previous.kind !== expectedKind || previous.kind === "option_response" && previous.scale !== scale || previous.convergence && previous.convergence.dimension !== dimension;
      return { ...block, id: changedFormat ? globalThis.crypto.randomUUID() : block.id, options: block.options.map(option => {
        const prior = previous.kind === "text" ? undefined : previous.options.find(item => item.id === option.id);
        if (!prior) return option;
        const unchanged = dimension === "location" ? prior.place?.name === option.place
          : dimension === "dates" ? prior.schedule?.startsOn === option.startsOn && prior.schedule?.endsOn === option.endsOn
            : dimension === "combination" ? prior.alternative?.startsOn === option.startsOn && prior.alternative?.endsOn === option.endsOn && prior.alternative?.place === option.place
              : prior.label === option.label;
        return unchanged && !changedFormat ? option : { ...option, id: globalThis.crypto.randomUUID() };
      }) };
    }) };
    const questions: PollQuestion[] = configuration.blocks.map(block => {
      const base = { id: block.id, prompt: block.prompt, required: block.required };
      if (block.type === "text") return { ...base, kind: "text" };
      if (block.type === "choice") return { ...base, kind: "choice", selectionMode: block.selectionMode!, options: block.options.map(option => ({ id: option.id, label: option.label!, description: null, exclusive: false })) };
      const dimension = block.type === "ranking" || block.type === "allocation" ? block.dimension! : block.type;
      const options: PollOption[] = block.options.map(option => {
        const common = { id: option.id, description: null, exclusive: false };
        if (dimension === "combination") { const alternative = { startsOn: option.startsOn!, endsOn: option.endsOn!, place: option.place! }; return { ...common, alternative, label: formatAlternativeLabel(alternative) }; }
        if (dimension === "dates") { const schedule = { startsOn: option.startsOn!, endsOn: option.endsOn!, startTime: "", endTime: "" }; return { ...common, schedule, label: formatPollSchedule(schedule, { mode: "ranges", timezone: "UTC" }) }; }
        return { ...common, place: { name: option.place! }, label: option.place! };
      });
      if (block.type === "combination") {
        const prior = input.previous ? datesLocationQuestions(input.previous.questions as PollQuestion[]) : null;
        return { ...base, kind: "choice", selectionMode: "multiple", convergence: { dimension, measure: "availability" }, options: [...options, { id: prior?.acceptable.id === block.id ? prior.acceptable.options.find(option => option.exclusive)?.id ?? globalThis.crypto.randomUUID() : globalThis.crypto.randomUUID(), label: NEITHER_LABEL, description: null, exclusive: true }] };
      }
      if (block.type === "ranking") return { ...base, kind: "ranking", options, convergence: { dimension, measure: "preference" } };
      if (block.type === "allocation") return { ...base, kind: "allocation", totalPoints: 10, options, convergence: { dimension, measure: "preference" } };
      const scale = block.type === "dates" ? "yes_maybe_no" : block.scale ?? "interest";
      return { ...base, kind: "option_response", scale, options, ...(block.type === "dates" ? { availability: { mode: "ranges" as const, timezone: "UTC" } } : {}), convergence: { dimension, measure: scale === "yes_maybe_no" ? "availability" : "interest" } };
    });
    return { title: input.title?.trim() || "Which dates and places fit?", intro: "Share your availability and preferences. Interest, rankings and points do not establish availability or decide the trip.", ballotMode: "transparent", recipeConfiguration: configuration, questions };
  }
  const alternatives = DatesLocationAlternativesSchema.parse(input.alternatives);
  const prior = input.previous ? datesLocationQuestions(input.previous.questions as PollQuestion[]) : null;
  const newId = () => globalThis.crypto.randomUUID();
  const acceptableId = prior?.acceptable.id ?? newId(), preferredId = prior?.preferred?.id ?? newId();
  const neither = prior?.acceptable.options.find(option => option.exclusive)?.id ?? newId();
  const options = alternatives.map(alternativeOption);
  return {
    recipeConfiguration: undefined,
    title: (input.title?.trim() || "Which dates and place work for you?").slice(0, 120),
    intro: "Each option is one set of dates in one place. Tell us every option you could do and which you would prefer. Nothing is booked or decided from these answers alone.",
    ballotMode: "transparent",
    questions: [
      { id: acceptableId, kind: "choice", prompt: ACCEPTABLE_PROMPT, required: true, selectionMode: "multiple",
        options: [...options, { id: neither, label: NEITHER_LABEL, description: null, exclusive: true }] },
      { id: preferredId, kind: "choice", prompt: PREFERRED_PROMPT, required: false, selectionMode: "single", options: options.map(option => ({ ...option })) },
    ],
  };
}

/** Typed alternatives recovered from a saved or published poll. */
export function alternativesFromQuestions(questions: PollQuestion[]): DatesLocationAlternative[] {
  const found = datesLocationQuestions(questions);
  if (!found) return [];
  return found.acceptable.options.flatMap(option => option.alternative ? [{ id: option.id, ...option.alternative }] : []);
}

/* ---------- Transparent overlap summary ---------- */

export type AlternativeParticipant = { key: string; name: string };
export type AlternativeResponse = AlternativeParticipant & { acceptable: string[]; neither: boolean; preferred: string | null; hasNeed: boolean };
export type AlternativeSummaryRow = {
  alternative: DatesLocationAlternative; label: string;
  acceptedBy: string[]; preferredBy: string[];
  /** Responders who did not say this option works, split by an explicit "none" and everything else. */
  notAcceptedBy: string[];
  /** True only when everyone who answered accepts it and nobody is still awaited. */
  worksForAllWhoAnswered: boolean; worksForEveryoneAsked: boolean;
};
export type AlternativeSummary = {
  rows: AlternativeSummaryRow[]; respondedCount: number; askedCount: number;
  awaiting: string[]; neitherCount: number; neitherBy: string[];
  /** Responders who answered something but not these questions, or answered from outside the audience. */
  unattributed: number; needsNoted: number;
};

/**
 * Pure and transparent: counts only what people answered. Silence is never a
 * yes or a no; people who have not answered are listed, not counted either way.
 */
export function summarizeAlternatives(input: { alternatives: DatesLocationAlternative[]; responses: AlternativeResponse[]; audience: AlternativeParticipant[] }): AlternativeSummary {
  const responded = new Set(input.responses.map(response => response.key));
  const awaiting = input.audience.filter(person => !responded.has(person.key)).map(person => person.name);
  const audienceKeys = new Set(input.audience.map(person => person.key));
  const rows = input.alternatives.map(alternative => {
    const accepted = input.responses.filter(response => response.acceptable.includes(alternative.id));
    const everyoneAnsweredYes = input.responses.length > 0 && accepted.length === input.responses.length;
    return { alternative, label: formatAlternativeLabel(alternative), acceptedBy: accepted.map(response => response.name),
      preferredBy: input.responses.filter(response => response.preferred === alternative.id).map(response => response.name),
      notAcceptedBy: input.responses.filter(response => !response.acceptable.includes(alternative.id)).map(response => response.name),
      worksForAllWhoAnswered: everyoneAnsweredYes, worksForEveryoneAsked: everyoneAnsweredYes && awaiting.length === 0 && input.audience.length > 0 };
  });
  const neither = input.responses.filter(response => response.neither);
  return { rows, respondedCount: input.responses.length, askedCount: input.audience.length, awaiting, neitherCount: neither.length, neitherBy: neither.map(response => response.name),
    unattributed: input.audience.length ? input.responses.filter(response => !audienceKeys.has(response.key)).length : 0,
    needsNoted: input.responses.filter(response => response.hasNeed).length };
}

/* ---------- Typed outcome and commands ---------- */

export const DatesLocationOutcomeSchema = z.object({
  kind: z.literal("dates_location"),
  alternativeId: z.string().uuid(),
  startsOn: z.iso.date(), endsOn: z.iso.date(), place: z.string().trim().min(1).max(60),
  /** Organizer-stated exceptions: who cannot make it, or conditions people raised. Never inferred. */
  exceptions: z.array(z.string().trim().min(1).max(300)).max(10),
  basis: z.object({ respondedCount: z.number().int().nonnegative(), askedCount: z.number().int().nonnegative(), awaitingCount: z.number().int().nonnegative(),
    acceptedCount: z.number().int().nonnegative(), preferredCount: z.number().int().nonnegative() }).strict(),
}).strict().refine(value => value.endsOn >= value.startsOn, "The end date must be on or after the start date.");
export type DatesLocationOutcome = z.infer<typeof DatesLocationOutcomeSchema>;

/** What the trip showed when the outcome was approved. Applying requires it to be unchanged. */
export const TripDatesLocationSchema = z.object({ startsOn: z.string().nullable(), endsOn: z.string().nullable(), locationNames: z.array(z.string()).max(20) }).strict();
export type TripDatesLocation = z.infer<typeof TripDatesLocationSchema>;

export const StartDatesLocationRunSchema = z.object({
  commandId: z.string().uuid(), runId: z.string().uuid(), draftId: z.string().uuid(),
  recipe: z.literal("dates_location"),
  title: z.string().trim().max(120).optional(),
  alternatives: DatesLocationAlternativesSchema.optional(),
  configuration: DatesLocationConfigurationSchema.optional(),
}).strict().refine(value => !(value.alternatives && value.configuration), "Choose alternatives or selectable questions, not both.");
export const SaveRecipeAlternativesSchema = z.object({
  commandId: z.string().uuid(), expectedDraftVersion: z.number().int().positive(),
  title: z.string().trim().max(120).optional(),
  alternatives: DatesLocationAlternativesSchema.optional(), configuration: DatesLocationConfigurationSchema.optional(),
}).strict().refine(value => Boolean(value.alternatives) !== Boolean(value.configuration), "Choose alternatives or selectable questions.");
export const ApproveRecipeOutcomeSchema = z.object({
  commandId: z.string().uuid(), pollId: z.string().uuid(), evidenceFingerprint: z.string().length(64),
  connectedEvidenceFingerprint: z.string().length(64).optional(),
  priorNeedResolutions: z.array(z.object({ pollId: z.string().uuid(), responseId: z.string().uuid(), questionId: z.string().uuid(), resolution: z.string().trim().min(1).max(500) }).strict()).max(200).default([]),
  alternativeId: z.string().uuid(),
  exceptions: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  needResolutions: z.array(z.object({ responseId: z.string().uuid(), questionId: z.string().uuid(), resolution: z.string().trim().min(1).max(500) }).strict()).max(200).default([]),
  uncertaintyAcknowledged: z.literal(true),
}).strict();
export const ApplyRecipeOutcomeSchema = z.object({
  commandId: z.string().uuid(), outcomeId: z.string().uuid(),
  /** The trip details the organizer saw. A mismatch means someone changed them; review again. */
  expected: TripDatesLocationSchema,
  applyDates: z.boolean(), applyLocation: z.boolean(),
}).strict().refine(value => value.applyDates || value.applyLocation, "Choose what to update on the trip.");
export const PublishRecipeRoundSchema = z.object({
  commandId: z.string().uuid(), expectedDraftVersion: z.number().int().positive(),
  /** Who can answer. Invitees must sign in; a link poll accepts a self-reported name and grants no trip access. */
  access: z.enum(["invitees", "link"]),
}).strict();
export const ReviseRecipeRoundSchema = z.object({ commandId: z.string().uuid(), expectedDraftVersion: z.number().int().positive() }).strict();

export type PublishRecipeRound = z.infer<typeof PublishRecipeRoundSchema>;
export type StartDatesLocationRun = z.infer<typeof StartDatesLocationRunSchema>;
export type SaveRecipeAlternatives = z.infer<typeof SaveRecipeAlternativesSchema>;
export type ApproveRecipeOutcome = z.infer<typeof ApproveRecipeOutcomeSchema>;
export type ApplyRecipeOutcome = z.infer<typeof ApplyRecipeOutcomeSchema>;

/** Dependency check: has the trip moved away from what an applied outcome set? Scoped to the fields the outcome owns. */
export function outcomeDrift(outcome: DatesLocationOutcome, applied: { dates: boolean; location: boolean }, trip: TripDatesLocation) {
  const changed: Array<"dates" | "location"> = [];
  if (applied.dates && (trip.startsOn !== outcome.startsOn || trip.endsOn !== outcome.endsOn)) changed.push("dates");
  if (applied.location && !trip.locationNames.some(name => name.trim().toLocaleLowerCase() === outcome.place.toLocaleLowerCase())) changed.push("location");
  return changed;
}
