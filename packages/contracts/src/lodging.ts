import { z } from "zod";

/*
 * Commons-native lodging journey (default off; apps/web/lib/server/lodging). Shapes for trip constraints, a saved lodging shortlist and the
 * preparation-only booking brief. Nothing here grants authority: the server validates every value again before it acts on it.
 */

const id = z.string().uuid();
const short = (max: number) => z.string().trim().min(1).max(max);

/** `shared` is visible to the trip's organizers and feeds research; `private:<personId>` is that person's own and never reaches shared research or a brief. */
export const ConstraintAudienceSchema = z.union([z.literal("shared"), z.string().regex(/^private:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)]);
export type ConstraintAudience = z.infer<typeof ConstraintAudienceSchema>;

export const TripConstraintKindSchema = z.enum(["max_nightly_cents", "min_bedrooms", "must_have", "avoid", "note"]);
export const TripConstraintInputSchema = z.object({
  kind: TripConstraintKindSchema,
  text: short(300),
  /** Required for `max_nightly_cents` (US cents) and `min_bedrooms` (a count). */
  value: z.number().int().positive().max(100_000_000).nullable().default(null),
  audience: ConstraintAudienceSchema.default("shared"),
}).strict().superRefine((input, context) => {
  const needsValue = input.kind === "max_nightly_cents" || input.kind === "min_bedrooms";
  if (needsValue && input.value === null) context.addIssue({ code: "custom", path: ["value"], message: "This constraint needs a number." });
  if (!needsValue && input.value !== null) context.addIssue({ code: "custom", path: ["value"], message: "This constraint has no number." });
});
export type TripConstraintInput = z.infer<typeof TripConstraintInputSchema>;

export const TripConstraintSchema = z.object({
  id, kind: TripConstraintKindSchema, text: z.string(), value: z.number().int().nullable(), audience: ConstraintAudienceSchema,
  authorPersonId: id, authorName: z.string(), version: z.number().int().positive(), createdAt: z.string().datetime(),
}).strict();
export type TripConstraint = z.infer<typeof TripConstraintSchema>;

// --- Research -----------------------------------------------------------------------------------------------------

export const EvidenceItemSchema = z.object({
  id: short(40), title: short(240), url: z.string().url().max(2048), excerpt: z.string().max(1200),
  /** True for fixtures: nothing here came from a real supplier or search. Always shown to the organizer. */
  synthetic: z.boolean(),
}).strict();
export const LodgingOptionSchema = z.object({
  optionId: short(40), name: short(160), address: short(240), bedrooms: z.number().int().min(0).max(30),
  nightlyCents: z.number().int().positive().max(10_000_000), totalCents: z.number().int().positive().max(100_000_000),
  evidenceIds: z.array(short(40)).min(1).max(5), caveats: z.array(z.string().max(300)).max(5),
}).strict();
export const ResearchBriefSchema = z.object({
  focus: short(300), startsOn: z.string().date(), endsOn: z.string().date(), locationName: z.string().nullable(),
  /** Shared constraints only. A research provider never receives a private constraint. */
  constraints: z.array(z.object({ kind: TripConstraintKindSchema, text: z.string(), value: z.number().int().nullable() }).strict()).max(50),
  returnAudience: z.literal("shared"),
}).strict();
export type ResearchBrief = z.infer<typeof ResearchBriefSchema>;

export const SpecialistResearchSchema = z.object({
  options: z.array(LodgingOptionSchema).min(1).max(5), evidence: z.array(EvidenceItemSchema).min(1).max(10),
  uncertainty: z.array(z.string().max(300)).max(6),
}).strict();
export type SpecialistResearch = z.infer<typeof SpecialistResearchSchema>;

export const ResearchRunSchema = SpecialistResearchSchema.extend({
  /** The provider that produced the run, chosen by server configuration (only `fixture` exists). */
  runId: id, constraintVersion: z.string(), adapter: short(40), synthetic: z.boolean(),
  /** `current` while the saved facts and shared constraints match what the run was briefed with. Derived on read, never stored. */
  status: z.enum(["current", "stale"]), createdAt: z.string().datetime(),
}).strict();
export type ResearchRun = z.infer<typeof ResearchRunSchema>;

// --- Booking brief (preparation only) -------------------------------------------------------------------------------

export const BookingBriefSchema = z.object({
  /** Always true. This is preparation; nothing is booked, held, paid for or sent. */
  preparationOnly: z.literal(true),
  statement: z.string().max(400),
  tripName: z.string(), locationName: z.string().nullable(),
  selectedOption: z.object({ name: z.string(), address: z.string(), startsOn: z.string(), endsOn: z.string(), totalCents: z.number().int(), evidenceUrls: z.array(z.string()).max(5), synthetic: z.boolean() }).strict(),
  travelers: z.array(z.object({ personId: id, name: z.string() }).strict()).max(100),
  constraintsApplied: z.array(z.string().max(300)).max(50),
  approvalBasis: z.object({ proposalTurnId: id, version: z.number().int().positive(), approvedByPersonId: id, approvedByName: z.string(), approvedAt: z.string().datetime() }).strict(),
  missingInformation: z.array(z.string().max(300)).max(20),
}).strict();
export type BookingBrief = z.infer<typeof BookingBriefSchema>;

// --- Review continuation, saved on the existing trip-change proposal ------------------------------------------------

/**
 * Written only by the server: the intent is saved with the proposal when Commons prepares it, and authorizes nothing. The outcome is written in the same
 * transaction as the canonical apply receipt, so a brief never exists before that receipt and exactly one outcome exists per applied proposal version.
 */
export const LodgingPreparationIntentSchema = z.object({
  schemaVersion: z.literal(1), nextAction: z.literal("prepare_lodging_brief"),
  /** The saved shortlist the option came from (its research command) and the shared facts/constraints version it was fresh against. */
  researchCommandId: id, researchRunId: id, optionId: short(40),
  constraintVersion: z.string().min(8).max(64), constraintIds: z.array(id).max(50),
  /** The travelers the prepared stay was meant to cover; the reviewed stay's own traveler list is what the brief uses. */
  travelerIds: z.array(id).max(100), requestedByPersonId: id,
  stay: z.object({ name: z.string().max(160), address: z.string().max(240), startsOn: z.string().date(), endsOn: z.string().date(), totalCents: z.number().int().positive() }).strict(),
}).strict();
// Older snapshots omitted currency; the native apply path only wrote USD stays.
const ApprovedStaySnapshotSchema = z.object({
  stay: z.object({ id, name: z.string(), address: z.string(), startsOn: z.string(), endsOn: z.string(), totalCents: z.number().int().nullable(), currency: z.string().optional() }).strict(),
  travelerIds: z.array(id).max(100),
}).strict();
export const LodgingPreparationOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("prepared"), appliedVersion: z.number().int().positive(), preparedAt: z.string().datetime(), brief: BookingBriefSchema, approvedSnapshot: ApprovedStaySnapshotSchema,
    /** Derived on read, never stored: the saved stay no longer matches what was approved, so this brief is out of date and is not regenerated. */
    staleSinceApproval: z.boolean().optional() }).strict(),
  z.object({ status: z.literal("unavailable"), appliedVersion: z.number().int().positive(), preparedAt: z.string().datetime(),
    reason: z.enum(["not_enabled", "edited_in_review", "stay_missing"]) }).strict(),
]);
export const LodgingPreparationSchema = z.object({ intent: LodgingPreparationIntentSchema, outcome: LodgingPreparationOutcomeSchema.nullable() }).strict();
export type LodgingPreparationIntent = z.infer<typeof LodgingPreparationIntentSchema>;
export type LodgingPreparationOutcome = z.infer<typeof LodgingPreparationOutcomeSchema>;
export type LodgingPreparation = z.infer<typeof LodgingPreparationSchema>;
