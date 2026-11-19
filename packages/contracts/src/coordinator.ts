import { CoordinatorPresentationSchema } from "./coordinator-presentation";
import { z } from "zod";
import { ItineraryDocumentRevisionSchema } from "./itinerary-document-revisions";
import { ItineraryActionSchema, ItineraryDraftSchema } from "./research-itinerary";
import { CoordinatorTripTaskActionSchema, CoordinatorTripTaskProposalSchema } from "./coordinator-trip-task";
import { PollWorkingDataSchema, PollWorkingDraftSchema } from "./poll";
import { TurnSteeringSchema } from "./coordinator-task";
import { CoordinatorErrorCodeSchema, CoordinatorInputModeSchema, CoordinatorThreadStateSchema, CoordinatorTurnLifecycleSchema, TurnCapabilitySchema, TurnNavigationSchema, TurnSourceRefSchema, TurnStatusSchema } from "./coordinator-turn";
import { ActivityIdeaReceiptSchema } from "./coordinator-activities";
import { LodgingPreparationSchema } from "./lodging";

export const ResearchSourceSchema = z.object({
  id: z.string().max(40), title: z.string().max(240), url: z.string().url().max(2048),
  excerpt: z.string().max(5000), retrievedAt: z.string().datetime(),
  coverage: z.enum(["snippet", "page"]),
  sourceKind: z.enum(["web", "browser_capture", "travel_provider"]).optional(),
  providerLabel: z.string().trim().min(1).max(120).optional(),
  capturedReferenceUrl: z.string().url().max(2048).optional(),
  freshUntil: z.string().datetime().optional(),
});
export const CoordinatorResearchSchema = z.object({
  query: z.string().min(1).max(500), sources: z.array(ResearchSourceSchema).max(5),
  status: z.enum(["complete", "partial", "unavailable"]), limitations: z.array(z.string().max(500)).max(8),
});
/** The saved records a planning proposal read. Private organizer-only metadata, never a poll field. */
export const ItineraryPlanningBasisSchema = z.object({
  tripVersion: z.string().datetime(),
  travelers: z.array(z.object({ id: z.string().max(80), version: z.string().datetime() }).strict()).max(60),
  stays: z.array(z.object({ id: z.string().max(80), version: z.string().datetime() }).strict()).max(10),
  plans: z.array(z.object({ id: z.string().max(80), version: z.string().datetime() }).strict()).max(40),
  logistics: z.array(z.object({ id: z.string().max(80), version: z.string().datetime() }).strict()).max(40),
}).strict();
const TripStayReviewSchema = z.object({
  id: z.string().uuid().nullable(), name: z.string().max(160), address: z.string().max(240),
  startsOn: z.string().date().nullable(), endsOn: z.string().date().nullable(),
  status: z.enum(["considering", "planned", "confirmed"]), totalCents: z.number().int().positive().max(100_000_000).nullable(),
  currency: z.literal("USD"), bookingUrl: z.string().url().max(2048).nullable(), updatedAt: z.string().datetime().nullable(),
});
/**
 * One existing plan item as reviewed. Time is kept as the item's own local date and clock time (its `timezone`), so the review shows and edits what the
 * organizer said; the server converts to an instant at apply. `contact` is an OPTION, never part of `note`: it goes on the note (which every traveler
 * can read) only when `include` is true at apply.
 */
export const TripPlanReviewSchema = z.object({
  id: z.string().uuid(), title: z.string().max(200),
  status: z.enum(["idea", "planned", "confirmed", "cancelled"]),
  timezone: z.string().min(1).max(80),
  startsOn: z.string().date().nullable(), startsTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  note: z.string().max(4000).nullable(),
  updatedAt: z.string().datetime(),
  contact: z.object({ text: z.string().min(1).max(200), include: z.boolean() }).nullable().default(null),
});
export type TripPlanReview = z.infer<typeof TripPlanReviewSchema>;
/** The note that will be saved: the reviewed note, plus the contact line only when the organizer chose to add it. */
export function planNoteToSave(plan: TripPlanReview): string | null {
  const note = plan.note?.trim() ? plan.note.trim() : null;
  if (!plan.contact?.include) return note;
  if (note?.includes(plan.contact.text)) return note;
  return note ? `${note}\n${plan.contact.text}` : plan.contact.text;
}
export const TripChangeFieldsSchema = z.object({
  budgetCents: z.number().int().positive().max(100_000_000).nullable(),
  startsOn: z.string().date().nullable(), endsOn: z.string().date().nullable(), locationName: z.string().trim().max(160).nullable(),
  stay: TripStayReviewSchema.nullable(), includedPersonIds: z.array(z.string().uuid()).max(100),
  /** Absent on reviews saved before plan updates existed. */
  plan: TripPlanReviewSchema.nullish(),
});
export const TripChangeProposalSchema = z.object({
  version: z.number().int().positive(), state: z.enum(["pending", "applied", "dismissed"]),
  source: z.string().trim().min(1).max(240),
  base: TripChangeFieldsSchema, changes: TripChangeFieldsSchema,
  travelers: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(160) })).max(100),
  operations: z.array(z.enum(["budget", "dates", "destination", "stay", "plan"])).min(1).max(5),
  receipt: z.object({ at: z.string().datetime(), appliedBy: z.string(), stayId: z.string().uuid().nullable(), planId: z.string().uuid().nullish(), resultingVersions: z.array(z.object({ id: z.string().uuid(), version: z.string() })).optional() }).nullable(),
  /** Present only on a lodging proposal Commons prepared from a saved shortlist on an enrolled trip. Written by the server; never accepted from a client. */
  preparation: LodgingPreparationSchema.optional(),
});
export type TripChangeProposal = z.infer<typeof TripChangeProposalSchema>;
export const CoordinatorTurnStopSchema = z.object({ attempt: z.number().int().min(1).max(3), requestedAt: z.string().datetime() }).strict();
export const CoordinatorTurnInterruptionSchema = z.object({
  attempt: z.number().int().min(1).max(3), at: z.string().datetime(),
  /**
   * lease_expired: nothing renewed the attempt. provider_started: execution was lost after work may have reached a provider, so it is not replayed.
   * deadline: the hard or stream-idle limit ended it. processing_stopped: the operator's emergency stop for durable execution.
   */
  reason: z.enum(["lease_expired", "provider_started", "deadline", "processing_stopped"]),
}).strict();
export type CoordinatorTurnInterruption = z.infer<typeof CoordinatorTurnInterruptionSchema>;
export const CoordinatorWorkspaceSchema = z.object({
  presentation: CoordinatorPresentationSchema.optional(),
  /** Server-validated reference to existing poll Work; never a mutation receipt. */
  /** Bounded private preparation offer, written only by the server. No publication or plan authority. */
  pollOffer: z.object({ request: z.string().min(1).max(4000), expiresAt: z.string().datetime() }).strict().optional(),
  pollReview: z.object({ draftId: z.string().uuid(), version: z.number().int().positive() }).strict().optional(),
  /** Authorized saved identities at rediscovery time; opening grants no new access. */
  pollDiscovery: z.array(z.object({kind:z.enum(["draft","poll"]),id:z.string().uuid(),title:z.string().max(240)}).strict()).max(80).optional(),
  taskProposal: CoordinatorTripTaskProposalSchema.optional(),
  itineraryDraft: ItineraryDraftSchema.optional(),
  /** Code-written acknowledgment of a committed edit to an existing private workshop document. */
  itineraryDocumentReceipt: z.object({ documentId: z.string().uuid(), version: z.number().int().positive(), commandId: z.string().uuid() }).strict().optional(),
  /** Server association for an explicit itinerary request, even when synthesis
   * produced no draft. The human text remains in its durable turn, not here.
   */
  itineraryInstruction: z.object({ draftId: z.string().uuid().nullable(), baseVersion: z.number().int().nonnegative() }).strict().optional(),
  tripConversation: z.boolean().optional(),
  attendanceReceipt: z.object({
    dates: z.string(), at: z.string().datetime(), undone: z.boolean().optional(),
    people: z.array(z.object({ personId: z.string().uuid(), name: z.string(), previousState: z.enum(["helping", "attending", "declined"]), previousDates: z.string().nullable() })),
  }).optional(),
  personality: z.enum(["commons", "joan", "becky", "miles"]).optional(),
  research: CoordinatorResearchSchema.optional(), saved: z.boolean().optional(), archivedAt: z.string().datetime().optional(),
  actedBy: z.object({ personId: z.string().uuid(), name: z.string(), at: z.string().datetime() }).optional(),
  proposal: z.object({ baseVersion: z.number().int().positive(), data: PollWorkingDataSchema,
    itineraryBasis: ItineraryPlanningBasisSchema.optional(),
    changes: z.array(z.string().max(120)).max(8), state: z.enum(["pending", "applied", "dismissed"]) }).optional(),
  tripProposal: TripChangeProposalSchema.optional(),
  /** The capability that handled the turn. Absent means an ordinary answer (or a row saved before Stage 4, where it is derived from the other fields). */
  invitationReview: z.array(z.object({email:z.string().email(),displayName:z.string().max(80)})).max(24).optional(),
  invitationRequest: z.boolean().optional(),
  invitationReceipt: z.array(z.object({ email: z.string().email(), status: z.enum(["queued", "already_invited", "already_member"]), invitationId: z.string().uuid().nullable(), deliveryAttemptId: z.string().uuid().nullable() })).max(24).optional(),
  activityReceipt: ActivityIdeaReceiptSchema.optional(),
  /** A canonical activity reference, never an expense receipt or authority to save. */
  expenseReview: z.object({ planId: z.string().uuid(), title: z.string().min(1).max(200) }).strict().optional(),
  capability: TurnCapabilitySchema.exclude(["answer"]).optional(),
  /** Navigation result of this turn (switched / created / clarify); replayed verbatim on lookup. */
  navigation: TurnNavigationSchema.optional(),
  /** Idea linked to this thread by this turn. Unlink (on the thread's linked ideas) is the undo. */
  linkedIdea: z.object({ linkId: z.string().uuid(), itineraryItemId: z.string().uuid(), title: z.string().max(200) }).optional(),
  /** Turn lifecycle, versioned. Absent = a turn saved before the feature = completed text turn. Production main strips this key and still works. */
  lifecycle: CoordinatorTurnLifecycleSchema.optional(),
  /** Thread summary / open questions / generated title as of this turn; the newest one in a thread wins. */
  threadState: CoordinatorThreadStateSchema.optional(),
  /** What this turn did about durable tasks (receipt, status, or a question about which task). Written by code from the database result. */
  steering: TurnSteeringSchema.optional(),
  /**
   * The author pressed Stop on this attempt, recorded in the same transaction that ended it. Older readers strip this key and read the turn as an
   * unfinished reply (provider_failed), which is what it is. Written only by the turn repository; a retry starts a new attempt without it.
   */
  stop: CoordinatorTurnStopSchema.optional(),
  /** The attempt ended because its execution was lost or overran. Nothing was saved as an answer, and nothing is replayed automatically. */
  interruption: CoordinatorTurnInterruptionSchema.optional(),
});
export type CoordinatorWorkspace = z.infer<typeof CoordinatorWorkspaceSchema>;
export type CoordinatorResearch = z.infer<typeof CoordinatorResearchSchema>;
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;
export const CoordinatorWorkspaceActionSchema = z.union([
  CoordinatorTripTaskActionSchema,
  ItineraryActionSchema,
  z.object({ turnId: z.string().uuid(), threadId: z.string().uuid().optional(), commandId: z.string().uuid(), action: z.enum(["apply", "dismiss", "save", "archive", "unarchive", "undo_attendance"]) }).strict(),
  z.object({ resourceType: z.enum(["draft", "poll"]), resourceId: z.string().uuid(), commandId: z.string().uuid(), action: z.enum(["archive", "unarchive"]) }).strict(),
  z.object({ turnId: z.string().uuid(), threadId: z.string().uuid().optional(), commandId: z.string().uuid(), action: z.enum(["revise_trip", "apply_trip", "dismiss_trip"]), expectedVersion: z.number().int().positive(), changes: TripChangeFieldsSchema.optional(),
    /** Apply only: the organizer's include/exclude choice for the contact stored with the proposal, sent with the apply itself (no separate save). `text` must equal the stored contact text exactly; the server never takes note text from here. */
    planContact: z.object({ text: z.string().min(1).max(200), include: z.boolean() }).strict().optional() }).strict(),
]);

export const CoordinatorTurnRequestSchema = z.object({
  commandId: z.string().uuid(), version: z.number().int().nonnegative(),
  prompt: z.string().trim().min(1).max(2000),
  threadId: z.string().uuid().optional(),
  draftId: z.string().uuid().nullable(), draftVersion: z.number().int().positive().nullable(),
  contextPollId: z.string().uuid().optional(),
  contextTurnId: z.string().uuid().optional(),
  researchQuery: z.string().trim().min(1).max(500).optional(),
}).strict().refine(input => Boolean(input.draftId) === Boolean(input.draftVersion), "Select a saved draft version.");
export const CoordinatorTurnSchema = z.object({
  id: z.string().uuid(), sequence: z.number().int().positive(),
  userText: z.string(), assistantText: z.string(), draftId: z.string().uuid().nullable(), createdAt: z.string().datetime(),
  threadId: z.string().uuid().nullable().optional(),
  workspace: CoordinatorWorkspaceSchema.nullable().optional(),
  authorName: z.string().optional(),
  authorPersonId: z.string().uuid().optional(),
  contextPollId: z.string().uuid().nullable().optional(),
  contextTurnId: z.string().uuid().nullable().optional(),
  /** The client command that created the turn. Lookups and retries are scoped to the author, so this grants nothing to other organizers. */
  commandId: z.string().uuid().optional(),
  /** Turn lifecycle (stored in `workspace.lifecycle`, no migration). Turns without one are `completed` from `text`. */
  status: TurnStatusSchema.optional(),
  inputMode: CoordinatorInputModeSchema.optional(),
  errorCode: CoordinatorErrorCodeSchema.nullable().optional(),
  spokenReply: z.string().max(600).nullable().optional(),
  sources: z.array(TurnSourceRefSchema).max(20).nullable().optional(),
});
export const CoordinatorPollResultSchema = z.object({
  formatNotice: z.string().max(240).optional(),
  questionId: z.string().uuid(), prompt: z.string(),
  options: z.array(z.object({ optionId: z.string().uuid(), label: z.string(), count: z.number().int().nonnegative() })),
  textResponseCount: z.number().int().nonnegative(),
});
export const CoordinatorThreadSummarySchema = z.object({
  id: z.string().uuid(), title: z.string().min(1).max(120), status: z.enum(["active", "archived"]),
  version: z.number().int().positive(), createdByPersonId: z.string().uuid(), createdByName: z.string(),
  turnCount: z.number().int().nonnegative(), draftCount: z.number().int().nonnegative(), pollCount: z.number().int().nonnegative(),
  archivedAt: z.string().datetime().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  /** `provisional` titles may be replaced once by a generated title; `organizer` titles never are. */
  titleSource: z.enum(["organizer", "provisional", "generated"]).optional(),
  summary: z.string().max(400).nullable().optional(),
});
export const CoordinatorLinkedIdeaSchema = z.object({
  id: z.string().uuid(), threadId: z.string().uuid(), itineraryItemId: z.string().uuid(), title: z.string(),
  status: z.enum(["idea", "planned", "confirmed", "cancelled"]), provenanceLabel: z.string(), sourceUrl: z.string().url().nullable(),
  linkedByPersonId: z.string().uuid(), linkedByName: z.string(), createdAt: z.string().datetime(),
});
export const CoordinatorResearchRunSchema = CoordinatorResearchSchema.extend({
  id: z.string().uuid(), threadId: z.string().uuid(), createdByPersonId: z.string().uuid(), createdByName: z.string(), createdAt: z.string().datetime(),
});
export const CoordinatorThreadSchema = z.object({
  itineraryReceipt: ItineraryDocumentRevisionSchema.optional(),
  version: z.number().int().nonnegative(), turns: z.array(CoordinatorTurnSchema), hasEarlier: z.boolean(),
  activeThreadId: z.string().uuid().nullable().optional(),
  threads: z.array(CoordinatorThreadSummarySchema).default([]),
  linkedIdeas: z.array(CoordinatorLinkedIdeaSchema).default([]),
  researchRuns: z.array(CoordinatorResearchRunSchema).default([]),
  drafts: z.array(PollWorkingDraftSchema.extend({ threadId: z.string().uuid().nullable().optional(), createdAt: z.string().datetime() })),
  polls: z.array(z.object({
    itinerary:z.boolean().optional(), superseded:z.boolean().optional(),
    id: z.string().uuid(), threadId: z.string().uuid().nullable().optional(), publicId: z.string().regex(/^[0-9a-f]{12}$/), title: z.string(), status: z.string(), createdAt: z.string().datetime(), audienceRestricted: z.boolean(),
    archivedAt: z.string().datetime().nullable().optional(),
    responseCount: z.number().int().nonnegative(), resultsVisible: z.boolean(), results: z.array(CoordinatorPollResultSchema),
  })),
});
export type CoordinatorThread = z.infer<typeof CoordinatorThreadSchema>;
export type CoordinatorTurnRequest = z.infer<typeof CoordinatorTurnRequestSchema>;
export type CoordinatorThreadSummary = z.infer<typeof CoordinatorThreadSummarySchema>;
export type CoordinatorLinkedIdea = z.infer<typeof CoordinatorLinkedIdeaSchema>;
export type CoordinatorResearchRun = z.infer<typeof CoordinatorResearchRunSchema>;

export const CreateCoordinatorThreadSchema = z.object({
  id: z.string().uuid().optional(), commandId: z.string().uuid(), title: z.string().trim().min(1).max(120),
}).strict();
export const UpdateCoordinatorThreadSchema = z.object({
  threadId: z.string().uuid(), commandId: z.string().uuid(), expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(120).optional(), status: z.enum(["active", "archived"]).optional(),
}).strict().refine(input => input.title !== undefined || input.status !== undefined, "Choose a thread change.");
export const CoordinatorThreadIdeaActionSchema = z.object({
  threadId: z.string().uuid(), itineraryItemId: z.string().uuid(), commandId: z.string().uuid(),
  expectedThreadVersion: z.number().int().positive(), action: z.enum(["link", "unlink"]),
}).strict();

/** Private, prepared advice. This is never itself a decision or shared event state. */
export const SaveCoordinatorRecommendationSchema = z.object({
  commandId: z.string().uuid(), expectedVersion: z.number().int().nonnegative(), sourcePollId: z.string().uuid(), evidenceFingerprint: z.string().length(64), preparedBy: z.string().trim().min(1).max(120),
  recommendation: z.string().trim().min(1).max(1500), freshness: z.string().trim().min(1).max(300),
  uncertainties: z.array(z.string().trim().min(1).max(500)).max(20), openQuestions: z.array(z.string().trim().min(1).max(500)).max(20), nextAction: z.string().trim().min(1).max(500),
}).strict();
export const CoordinatorRecommendationSchema = SaveCoordinatorRecommendationSchema.omit({ commandId: true, expectedVersion: true }).extend({
  id: z.string().uuid(), version: z.number().int().positive(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  /** Calculated at read time; false means the linked poll evidence changed after this was prepared. */
  evidenceCurrent: z.boolean().optional(),
});
export type CoordinatorRecommendation = z.infer<typeof CoordinatorRecommendationSchema>;
