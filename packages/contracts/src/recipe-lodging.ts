import { z } from "zod";
import { formatEstimate, PollPropertySchema, sleepingLabels, sleepingNeeds, type SleepingNeed } from "./poll-recipe-fields";
import type { PollOption, PollQuestion, PollWorkingData } from "./poll";
import { TripDatesLocationSchema, type TripDatesLocation } from "./recipe";
import { formatTripDateRange } from "./attendance";

/* Lodging: choose among places an organizer supplied. Nothing here finds, prices, reserves or books anything. */

export const LodgingPropertyInputSchema = PollPropertySchema.extend({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Name each place.").max(80),
  url: z.string().trim().url("Add the link you were given for each place.").max(2048).refine(value => /^https?:\/\//i.test(value), "Use an http or https link."),
  description: z.string().trim().max(180).nullable().default(null),
});
export type LodgingPropertyInput = z.infer<typeof LodgingPropertyInputSchema>;
export const LodgingPropertiesSchema = z.array(LodgingPropertyInputSchema).min(2, "Add at least two places to compare.").max(8, "Compare at most eight places.")
  .superRefine((items, ctx) => {
    if (new Set(items.map(item => item.id)).size !== items.length) ctx.addIssue({ code: "custom", message: "Each place needs its own identifier." });
    if (new Set(items.map(item => item.url)).size !== items.length) ctx.addIssue({ code: "custom", message: "Each place needs its own link." });
  });

export const LODGING_ACCEPTABLE_PROMPT = "Which of these could you stay at? Select every place that works for you.";
export const LODGING_PREFERRED_PROMPT = "If you could only pick one, which would you prefer?";
export const SLEEPING_PROMPT = "How would you like to sleep?";
export const CHILDREN_PROMPT = "Are you traveling with a baby or young child?";
export const LODGING_NEITHER_LABEL = "None of these work for me";

export function lodgingQuestions(questions: PollQuestion[]) {
  const choice = questions.filter((question): question is Extract<PollQuestion, { kind: "choice" }> => question.kind === "choice");
  const acceptable = choice.find(question => question.selectionMode === "multiple" && question.options.some(option => option.property));
  if (!acceptable) return null;
  return { acceptable, preferred: choice.find(question => question.selectionMode === "single" && question.options.some(option => option.property)) ?? null,
    sleeping: choice.find(question => question.options.some(option => option.sleeping)) ?? null, children: choice.find(question => question.prompt === CHILDREN_PROMPT) ?? null };
}
export function propertiesFromQuestions(questions: PollQuestion[]): LodgingPropertyInput[] {
  const found = lodgingQuestions(questions);
  return found ? found.acceptable.options.flatMap(option => option.property && option.url ? [{ id: option.id, name: option.label, url: option.url, description: option.description ?? null, ...option.property }] : []) : [];
}
export function childrenAsked(questions: PollQuestion[]) { return Boolean(lodgingQuestions(questions)?.children); }

export function buildLodgingPollData(input: { properties: LodgingPropertyInput[]; trip: TripDatesLocation; askAboutChildren?: boolean; title?: string; previous?: Pick<PollWorkingData, "questions"> | null }): PollWorkingData {
  const properties = LodgingPropertiesSchema.parse(input.properties), trip = TripDatesLocationSchema.parse(input.trip);
  const prior = input.previous ? lodgingQuestions(input.previous.questions as PollQuestion[]) : null;
  const newId = () => globalThis.crypto.randomUUID();
  const option = (item: LodgingPropertyInput): PollOption => ({ id: item.id, label: item.name, description: item.description, exclusive: false, url: item.url,
    property: { rooms: item.rooms, beds: item.beds, pricing: item.pricing } });
  const sleepingOption = (need: SleepingNeed): PollOption => ({ id: prior?.sleeping?.options.find(existing => existing.sleeping === need)?.id ?? newId(), label: sleepingLabels[need], description: null, exclusive: false, sleeping: need });
  const yesNo = (label: string): PollOption => ({ id: prior?.children?.options.find(existing => existing.label === label)?.id ?? newId(), label, description: null, exclusive: false });
  const when = trip.startsOn && trip.endsOn ? formatTripDateRange(trip.startsOn, trip.endsOn) : "dates to be confirmed";
  let questions: PollWorkingData["questions"] = [
    { id: prior?.acceptable.id ?? newId(), kind: "choice", prompt: LODGING_ACCEPTABLE_PROMPT, required: true, selectionMode: "multiple",
      options: [...properties.map(option), { id: prior?.acceptable.options.find(existing => existing.exclusive)?.id ?? newId(), label: LODGING_NEITHER_LABEL, description: null, exclusive: true }] },
    { id: prior?.preferred?.id ?? newId(), kind: "choice", prompt: LODGING_PREFERRED_PROMPT, required: false, selectionMode: "single", options: properties.map(option) },
    { id: prior?.sleeping?.id ?? newId(), kind: "choice", prompt: SLEEPING_PROMPT, required: true, selectionMode: "single", options: sleepingNeeds.map(sleepingOption) },
  ];
  if (input.askAboutChildren) questions.push({ id: prior?.children?.id ?? newId(), kind: "choice", prompt: CHILDREN_PROMPT, required: false, selectionMode: "single", options: [yesNo("Yes"), yesNo("No")] });
  if (prior && input.previous) {
    const owned = new Set([prior.acceptable.id, prior.preferred?.id, prior.sleeping?.id, prior.children?.id]);
    const rebuilt = new Map(questions.map(question => [question.id, question]));
    questions = input.previous.questions.flatMap(previous => {
      const replacement = rebuilt.get(previous.id);
      if (replacement) { rebuilt.delete(previous.id); return [{ ...replacement, prompt: previous.prompt, required: previous.required }]; }
      return owned.has(previous.id) ? [] : [previous];
    });
    questions.push(...rebuilt.values());
  }
  return { recipeTrip: trip, title: (input.title?.trim() || "Where should we stay?").slice(0, 120),
    intro: `Places an organizer found for ${when}. Prices are the organizer’s estimates, not quotes, and nothing is booked or held. Your answers help choose; they don’t reserve a room.`,
    ballotMode: "transparent", questions };
}

export type LodgingResponseFact = { key: string; name: string; acceptable: string[]; neither: boolean; preferred: string | null; sleeping: SleepingNeed | null; children: boolean | null; hasNeed: boolean };
export type LodgingRow = {
  property: LodgingPropertyInput; pricing: string; acceptedBy: string[]; preferredBy: string[]; notAcceptedBy: string[];
  /** Conflicts between what people said they need and what this place lists. Visible before approval; never resolved silently. */
  conflicts: string[];
};
export type LodgingSummary = {
  rows: LodgingRow[]; respondedCount: number; askedCount: number; awaiting: string[]; neitherBy: string[];
  sleeping: Record<SleepingNeed, string[]>; childrenYes: string[];
};
export function summarizeLodging(input: { properties: LodgingPropertyInput[]; responses: LodgingResponseFact[]; audience: Array<{ key: string; name: string }> }): LodgingSummary {
  const responded = new Set(input.responses.map(response => response.key));
  const rows = input.properties.map(property => {
    const accepted = input.responses.filter(response => response.acceptable.includes(property.id));
    const needsSeparate = accepted.filter(response => response.sleeping === "own_bed" || response.sleeping === "separate_beds").map(response => response.name);
    const conflicts: string[] = [];
    if (needsSeparate.length && property.beds === "king_only") conflicts.push(`${needsSeparate.join(", ")} asked for their own bed or separate beds, and this place lists only king beds.`);
    else if (needsSeparate.length && property.beds === "unknown") conflicts.push(`Bed setup isn’t listed. ${needsSeparate.join(", ")} asked for their own bed or separate beds. Check before choosing.`);
    return { property, pricing: formatEstimate(property.pricing), acceptedBy: accepted.map(response => response.name), preferredBy: input.responses.filter(response => response.preferred === property.id).map(response => response.name),
      notAcceptedBy: input.responses.filter(response => !response.acceptable.includes(property.id)).map(response => response.name), conflicts };
  });
  const sleeping = { own_bed: [], share_bed: [], separate_beds: [], no_preference: [] } as Record<SleepingNeed, string[]>;
  for (const response of input.responses) if (response.sleeping) sleeping[response.sleeping].push(response.name);
  return { rows, respondedCount: input.responses.length, askedCount: input.audience.length, awaiting: input.audience.filter(person => !responded.has(person.key)).map(person => person.name),
    neitherBy: input.responses.filter(response => response.neither).map(response => response.name), sleeping, childrenYes: input.responses.filter(response => response.children).map(response => response.name) };
}

export const LodgingOutcomeSchema = z.object({
  kind: z.literal("lodging"),
  optionId: z.string().uuid(), name: z.string().max(80), url: z.string().max(2048), rooms: z.string().max(180), beds: z.enum(["separate_beds_available", "king_only", "unknown"]),
  pricing: z.string().max(400),
  acceptedCount: z.number().int().nonnegative(), preferredCount: z.number().int().nonnegative(), respondedCount: z.number().int().nonnegative(), awaitingCount: z.number().int().nonnegative(),
  /** Conflicts that were on screen when this was approved. Naming them is the organizer's acknowledgement, not a resolution. */
  conflictsAcknowledged: z.array(z.string().max(400)).max(10),
  exceptions: z.array(z.string().trim().min(1).max(300)).max(10),
  /** Explicitly reviewed public wording. Absence on legacy outcomes never makes private exceptions public. */
  participantSummary: z.string().trim().min(1).max(500).optional(),
  /** The headcount this was chosen against, and which attendance result it came from. */
  basedOn: z.object({ trip: TripDatesLocationSchema, attendanceOutcomeId: z.string().uuid().nullable(), headcountIn: z.number().int().nonnegative().nullable(), headcountMaybe: z.number().int().nonnegative().nullable() }).strict(),
}).strict();
export type LodgingOutcome = z.infer<typeof LodgingOutcomeSchema>;

export const StartLodgingRunSchema = z.object({ commandId: z.string().uuid(), runId: z.string().uuid(), draftId: z.string().uuid(), recipe: z.literal("lodging"), title: z.string().trim().max(120).optional(),
  properties: LodgingPropertiesSchema.optional(), askAboutChildren: z.boolean().default(false) }).strict();
export const SaveLodgingSchema = z.object({ commandId: z.string().uuid(), expectedDraftVersion: z.number().int().positive(), title: z.string().trim().max(120).optional(),
  intro: z.string().max(500).nullable().optional(),
  reviewedContextFingerprint: z.string().length(64).optional(),
  properties: LodgingPropertiesSchema, askAboutChildren: z.boolean().default(false) }).strict();
export const ApproveLodgingSchema = z.object({
  commandId: z.string().uuid(), pollId: z.string().uuid(), evidenceFingerprint: z.string().length(64), optionId: z.string().uuid(),
  exceptions: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  /** Must list every conflict shown for the chosen place, so approving never hides one. */
  acknowledgedConflicts: z.array(z.string().max(400)).max(10).default([]),
  needResolutions: z.array(z.object({ responseId: z.string().uuid(), questionId: z.string().uuid(), resolution: z.string().trim().min(1).max(500) }).strict()).max(200).default([]),
  uncertaintyAcknowledged: z.literal(true),
  /** Exact participant-facing recap, explicitly reviewed separately from private needs. */
  participantSummary: z.string().trim().min(1).max(500).optional(),
  contextFingerprint: z.string().length(64).optional(),
}).strict();
export type ApproveLodging = z.infer<typeof ApproveLodgingSchema>;
