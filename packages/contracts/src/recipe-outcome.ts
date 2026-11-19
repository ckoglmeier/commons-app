import { z } from "zod";
import { ApproveFoodSchema, FoodOutcomeSchema, SaveFoodSchema, StartFoodRunSchema, type FoodSummary } from "./recipe-food";
import { formatTripDateRange } from "./attendance";
import { AttendanceOutcomeSchema, ApproveAttendanceSchema, SaveAttendanceSchema, StartAttendanceRunSchema, type AttendanceSummary } from "./recipe-attendance";
import { ApproveLodgingSchema, LodgingOutcomeSchema, SaveLodgingSchema, StartLodgingRunSchema, type LodgingPropertyInput, type LodgingSummary } from "./recipe-lodging";
import {
  ApproveRecipeOutcomeSchema, DatesLocationOutcomeSchema, SaveRecipeAlternativesSchema, StartDatesLocationRunSchema, outcomeDrift,
  type AlternativeSummary, type DatesLocationAlternative, type RecipeId, type RecipeStage, type TripDatesLocation,
  type DatesLocationConfiguration, formatAlternativeLabel,
} from "./recipe";
import type { PollQuestion, PublicPoll } from "./poll";
import type { RecipeAdvice, RecipeEvidenceBundle } from "./recipe-advice";
import type { RecipeContext } from "./recipe-context";
import type { TripContextSnapshot } from "./coordinator-turn";

/** A typed, approved result. Each kind has its own validated payload; none is free-form instruction text. */
export const RecipeOutcomeSchema = z.discriminatedUnion("kind", [DatesLocationOutcomeSchema, AttendanceOutcomeSchema, LodgingOutcomeSchema, FoodOutcomeSchema]);
export type RecipeOutcome = z.infer<typeof RecipeOutcomeSchema>;

/** Participant allowlist, also used for legacy decisions whose stored summary
 * mixed in organizer-only exceptions. Never redact free text with a regex or
 * rewrite the original approval/history to repair a public projection. */
export function participantRecipeSummary(raw: unknown): string {
  const parsed = RecipeOutcomeSchema.safeParse(raw);
  if (!parsed.success) return "An organizer recorded a decision for this poll.";
  const result = parsed.data;
  if (result.kind === "dates_location") return `Chose ${formatAlternativeLabel({ startsOn: result.startsOn, endsOn: result.endsOn, place: result.place })}.`;
  if (result.kind === "attendance") return `Attendance when voting closed: ${result.counts.in} in, ${result.counts.maybe} maybe, ${result.counts.out} out, ${result.counts.unanswered} not answered. Nobody’s own RSVP changed.`;
  if (result.kind === "lodging") return result.participantSummary ?? `Chose ${result.name} as the group’s preferred place to stay. This is a preference, not a booking. Confirm sleeping setup, final price and availability before booking.`;
  return "Recorded meal preferences for planning. Individual answers stay with organizers.";
}

export const StartRecipeRunSchema = z.discriminatedUnion("recipe", [StartDatesLocationRunSchema, StartAttendanceRunSchema, StartLodgingRunSchema, StartFoodRunSchema]);
export type StartRecipeRun = z.infer<typeof StartRecipeRunSchema>;
/** Each recipe validates its own save and approval payloads; the server picks the schema from the run, never from the request. */
export const saveSchemaFor = { dates_location: SaveRecipeAlternativesSchema, attendance: SaveAttendanceSchema, lodging: SaveLodgingSchema, food_preferences: SaveFoodSchema } as const;
export const approveSchemaFor = { dates_location: ApproveRecipeOutcomeSchema, attendance: ApproveAttendanceSchema, lodging: ApproveLodgingSchema, food_preferences: ApproveFoodSchema } as const;
export type GuidedRecipeId = keyof typeof saveSchemaFor;
export const guidedRecipeIds = ["dates_location", "attendance", "lodging", "food_preferences"] as const satisfies readonly RecipeId[];

/* ---------- Staleness: what an approved result was built on, checked against what is true now ---------- */

export type StaleReason = { field: "dates" | "location" | "headcount" | "context"; message: string };
export type OutcomeContext = { trip: TripDatesLocation; attendance: { outcomeId: string; headcountIn: number; headcountMaybe: number } | null };
const range = (trip: TripDatesLocation) => trip.startsOn && trip.endsOn ? formatTripDateRange(trip.startsOn, trip.endsOn) : "not set";
const names = (trip: TripDatesLocation) => trip.locationNames.length ? trip.locationNames.join(", ") : "not set";

/**
 * Scoped to the fields each result depends on, never to every trip edit. A stale result stays on record as history; a person decides
 * whether to ask again. Nothing here recalculates or replaces a human decision.
 */
export function outcomeStaleness(outcome: { status: "approved" | "applied" | "superseded"; result: RecipeOutcome; appliedTargets: { dates: boolean; location: boolean } | null }, now: OutcomeContext): StaleReason[] {
  if (outcome.status === "superseded") return [];
  const result = outcome.result, reasons: StaleReason[] = [];
  const datesChanged = (base: TripDatesLocation) => base.startsOn !== now.trip.startsOn || base.endsOn !== now.trip.endsOn;
  const locationChanged = (base: TripDatesLocation) => base.locationNames.join("|").toLocaleLowerCase() !== now.trip.locationNames.join("|").toLocaleLowerCase();
  if (result.kind === "dates_location") {
    if (outcome.status === "applied" && outcome.appliedTargets) for (const field of outcomeDrift(result, outcome.appliedTargets, now.trip))
      reasons.push(field === "dates" ? { field, message: `The trip dates changed after this was applied. They are now ${range(now.trip)}.` } : { field, message: `The trip location changed after this was applied. It is now ${names(now.trip)}.` });
  } else if (result.kind === "attendance") {
    if (datesChanged(result.basedOn)) reasons.push({ field: "dates", message: `Attendance was asked for ${range(result.basedOn)}. The trip dates are now ${range(now.trip)}.` });
    if (locationChanged(result.basedOn)) reasons.push({ field: "location", message: `Attendance was asked about ${names(result.basedOn)}. The trip location is now ${names(now.trip)}.` });
  } else if (result.kind === "lodging") {
    if (datesChanged(result.basedOn.trip)) reasons.push({ field: "dates", message: `This place was chosen for ${range(result.basedOn.trip)}. The trip dates are now ${range(now.trip)}.` });
    const was = result.basedOn.headcountIn, current = now.attendance;
    if (result.basedOn.attendanceOutcomeId !== (current?.outcomeId ?? null) || was !== null && (!current || current.headcountIn !== was || current.headcountMaybe !== result.basedOn.headcountMaybe))
      reasons.push({ field: "headcount", message: `${was === null ? "This place was chosen before an attendance result was recorded" : `This place was chosen with ${was} people confirmed${result.basedOn.headcountMaybe ? ` and ${result.basedOn.headcountMaybe} maybe` : ""}`}. ${current ? `Attendance now says ${current.headcountIn}${current.headcountMaybe ? ` and ${current.headcountMaybe} maybe` : ""}.` : "There is no current attendance result."}` });
  }
  return reasons;
}

/* ---------- Read models ---------- */

export const SetRecipeDraftArchivedSchema = z.object({
  commandId: z.string().uuid(), expectedDraftVersion: z.number().int().positive(), archived: z.boolean(),
});

export type RecipeRunSummary = {
  archived?: boolean; draftVersion?: number; canDelete?: boolean;
  id: string; recipe: RecipeId; title: string; stage: RecipeStage; draftId: string | null; pollId: string | null;
  responseCount: number; outcomeStatus: "approved" | "applied" | "superseded" | null; updatedAt: string; rounds: number;
  /** Why an approved or applied result may need another look; empty when nothing it depended on has changed. */
  stale: StaleReason[];
};
export type OutcomeView = { id: string; status: "approved" | "applied" | "superseded"; result: RecipeOutcome; base: TripDatesLocation; approvedByName: string; approvedAt: string;
  appliedAt: string | null; appliedTargets: { dates: boolean; location: boolean } | null; stale: StaleReason[] };
export type RecipeNote = { responseId: string; questionId: string; respondentName: string; kind: "preference" | "need" | "note"; text: string };
type RunBase = {
  id: string; title: string; workflow: { key: string; version: number }; stage: RecipeStage;
  intro?: string | null;
  participantPreview?: { title: string; intro: string | null; questions: PollQuestion[] };
  publicationAudience?: string[];
  participantDecision?: { summary: string; publicId: string };
  draft: { id: string; version: number; published: boolean; archived: boolean };
  poll: { id: string; publicId: string; status: "open" | "closed" | "revoked"; responseCount: number; superseded: boolean; audienceKind: "invitees" | "link"; ballotMode: "transparent" | "secret" } | null;
  /** Free text people attached to answers. A "need" must be explained before approval. */
  notes: RecipeNote[];
  /** Present only while a closed, current round can still be approved. */
  evidenceFingerprint: string | null;
  outcome: OutcomeView | null;
  trip: TripDatesLocation;
  askedTrip: TripDatesLocation | null;
  /** Saved private handoff and a fresh authorized comparison, never participant content. */
  context?: { saved: RecipeContext | null; current: RecipeContext; changed: boolean };
  /** The current approved headcount from attendance, when there is one. Context for the run, never authority. */
  headcount: { outcomeId: string; in: number; maybe: number; approvedAt: string } | null;
  history: Array<{ pollId: string | null; stage: RecipeStage; outcomeStatus: "approved" | "applied" | "superseded" | null; responseCount: number }>;
};
export type DatesLocationRunDetail = RunBase & { recipe: "dates_location"; alternatives: DatesLocationAlternative[]; summary: AlternativeSummary | null;
  advice?: RecipeAdvice; connectedEvidence?: RecipeEvidenceBundle;
  configuration?: DatesLocationConfiguration; questions?: PollQuestion[]; exploratory?: boolean; ballotResults?: Pick<PublicPoll, "questions" | "aggregates" | "responseCount" | "resultsVisible" | "identityBound"> };
export type AttendanceRunDetail = RunBase & { recipe: "attendance"; summary: AttendanceSummary | null; /** Organizer-entered notes saved with the approval, never before it. */ people: Array<{ personId: string; name: string }> };
export type LodgingRunDetail = RunBase & { recipe: "lodging"; properties: LodgingPropertyInput[]; askAboutChildren: boolean; summary: LodgingSummary | null };
export type FoodRunDetail = RunBase & { recipe: "food_preferences"; summary: FoodSummary | null; /** Organizer-only historical input, never votes on this round. */ earlierFoodAnswers?: TripContextSnapshot["foodPreferences"] };
export type RecipeRunDetail = DatesLocationRunDetail | AttendanceRunDetail | LodgingRunDetail | FoodRunDetail;
