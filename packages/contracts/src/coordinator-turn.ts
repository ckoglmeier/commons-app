import { TripPlanningContextSchema } from "./trip-planning-context";
import { FlightConnectionSchema } from "./travel";
import { z } from "zod";
import { ItineraryFactsSchema } from "./research-itinerary";
import { ItineraryRequestSchema } from "./research-itinerary";
import { CoordinatorPersonalityIdSchema } from "./coordinator-personality";
import { TaskControlActionSchema } from "./coordinator-task";
import { WorkflowKeySchema } from "./workflows";

/*
 * Coordinator turn contracts (docs/COORDINATOR-WORKSPACE-DESIGN.md §3).
 * One command/result shape for typed and spoken turns. Nothing here grants
 * authority: every command is re-authorized, scoped, and version-checked on the
 * server at execution and at commit.
 */

// ---------------------------------------------------------------------------
// Stable error codes (R7)
// ---------------------------------------------------------------------------

export const CoordinatorErrorCodeSchema = z.enum([
  "auth_expired", // no valid session; sign in again
  "membership_lost", // no active membership on this trip
  "organizer_required", // active member, but organizer APIs need an active organizer
  "thread_unavailable", // thread not found in this trip (or never visible to this actor)
  "thread_archived", // thread exists but is archived
  "artifact_missing", // referenced draft/poll/note/proposal no longer exists
  "artifact_misassociated", // referenced artifact belongs to another thread or trip
  "stale_version", // thread/artifact/fact version moved; refresh before retrying
  "command_mismatch", // command id reused with a different payload
  "research_limited", // shared beta research allowance unavailable
  "rate_limited", // trip inference quota reached
  "provider_not_configured", // model/research/voice provider not connected here
  "provider_failed", // provider error, timeout, or invalid completion
  "unsupported_capability", // Commons cannot do this (booking, payment, merge, ...)
  "invalid_request", // malformed or out-of-bounds input
  "internal_error", // unexpected server failure; nothing is assumed saved
]);
export type CoordinatorErrorCode = z.infer<typeof CoordinatorErrorCodeSchema>;

export const CoordinatorErrorSchema = z.object({
  code: CoordinatorErrorCodeSchema,
  retryable: z.boolean(),
  /** Screen copy (COPY.md voice). Never contains model output, record contents, or identifiers. */
  userMessage: z.string().min(1).max(300),
}).strict();
export type CoordinatorError = z.infer<typeof CoordinatorErrorSchema>;

type ErrorCatalogEntry = { httpStatus: number; retryable: boolean; userMessage: string; spokenMessage: string };

/**
 * Single source for status, retry policy, and copy. Voice speaks `spokenMessage`
 * verbatim; it must not reinterpret a code (for example as "wrong account" or
 * "reloading") because it cannot reload or change accounts.
 */
export const coordinatorErrorCatalog = {
  auth_expired: { httpStatus: 401, retryable: false, userMessage: "Sign in again to continue. Your unsent message is still here.", spokenMessage: "Your sign-in expired. Sign in again on screen, then ask me again." },
  membership_lost: { httpStatus: 403, retryable: false, userMessage: "You’re no longer on this trip, so this conversation is closed.", spokenMessage: "You no longer have access to this trip, so I can’t continue." },
  organizer_required: { httpStatus: 403, retryable: false, userMessage: "Only trip organizers can use the coordinator.", spokenMessage: "Only trip organizers can use the coordinator." },
  thread_unavailable: { httpStatus: 404, retryable: false, userMessage: "This thread isn’t available. Choose another thread or start a new one.", spokenMessage: "That thread isn’t available. Pick another thread on screen or start a new one." },
  thread_archived: { httpStatus: 409, retryable: false, userMessage: "This thread is archived. Restore it to continue here.", spokenMessage: "That thread is archived. Restore it on screen to continue there." },
  artifact_missing: { httpStatus: 404, retryable: false, userMessage: "That draft or poll no longer exists. Nothing changed.", spokenMessage: "That draft or poll no longer exists. Nothing changed." },
  artifact_misassociated: { httpStatus: 409, retryable: false, userMessage: "That draft belongs to another thread. Open it there to continue. Nothing changed.", spokenMessage: "That draft belongs to another thread, so I didn’t change it." },
  stale_version: { httpStatus: 409, retryable: true, userMessage: "This thread changed while you were working. It’s refreshed. Send again to continue.", spokenMessage: "Something in this thread changed while I was working, so I didn’t save that. Please ask again." },
  command_mismatch: { httpStatus: 409, retryable: false, userMessage: "That request couldn’t be matched to your message. Send it again.", spokenMessage: "I couldn’t match that request. Please ask again." },
  research_limited: { httpStatus: 429, retryable: true, userMessage: "Research is temporarily paused. Your saved work is unchanged. Please try again later.", spokenMessage: "Research is temporarily paused. Your saved work is unchanged." },
  rate_limited: { httpStatus: 429, retryable: true, userMessage: "This trip has reached its hourly conversation limit. You can still edit directly.", spokenMessage: "This trip has reached its hourly conversation limit. You can still edit on screen." },
  provider_not_configured: { httpStatus: 503, retryable: false, userMessage: "Conversation isn’t connected here yet. You can still edit directly.", spokenMessage: "That part of Commons isn’t connected here yet." },
  provider_failed: { httpStatus: 502, retryable: true, userMessage: "Commons couldn’t finish that reply. Your message is saved. Try again.", spokenMessage: "I couldn’t finish that. Your request is saved in the thread; you can try again." },
  unsupported_capability: { httpStatus: 422, retryable: false, userMessage: "Commons can’t do that yet. Nothing changed.", spokenMessage: "I can’t do that yet, and nothing changed." },
  invalid_request: { httpStatus: 400, retryable: false, userMessage: "That request was incomplete. Check it and try again.", spokenMessage: "I didn’t get a complete request. Please say it again." },
  internal_error: { httpStatus: 500, retryable: true, userMessage: "Something went wrong. Check the thread before trying again. Nothing was shared.", spokenMessage: "Something went wrong on my side. Check the thread on screen before trying again." },
} as const satisfies Record<CoordinatorErrorCode, ErrorCatalogEntry>;

export function coordinatorError(code: CoordinatorErrorCode): CoordinatorError {
  const entry = coordinatorErrorCatalog[code];
  return { code, retryable: entry.retryable, userMessage: entry.userMessage };
}

// ---------------------------------------------------------------------------
// Turn command (client -> server)
// ---------------------------------------------------------------------------

export const CoordinatorInputModeSchema = z.enum(["text", "voice"]);
export type CoordinatorInputMode = z.infer<typeof CoordinatorInputModeSchema>;

export const TurnTargetSchema = z.discriminatedUnion("kind", [
  /** Continue an existing organizer thread. `expectedTurnVersion` is the latest turn sequence the client saw. */
  z.object({ kind: z.literal("existing"), threadId: z.string().uuid(), expectedTurnVersion: z.number().int().nonnegative() }).strict(),
  /**
   * Start an ordinary conversation. The client generates `threadId` once and reuses it on retry,
   * so the thread and the first pending human turn are created atomically and idempotently.
   */
  z.object({ kind: z.literal("new"), threadId: z.string().uuid() }).strict(),
]);
export type TurnTarget = z.infer<typeof TurnTargetSchema>;

/** A selected artifact the organizer is discussing. Must belong to the target thread (or be an unthreaded shared artifact adopted by it). */
export const TurnArtifactRefSchema = z.discriminatedUnion("kind", [
  /**
   * `selection` tells the router why the draft is attached. `selected` (the default) = the organizer chose it in the UI
   * (Ask the group / draft editing context), so edit-like requests edit it. `thread_context` = the client attached the
   * thread's unpublished goal draft automatically; it is context for the model only and never steers routing.
   */
  z.object({ kind: z.literal("draft"), id: z.string().uuid(), version: z.number().int().positive(), selection: z.enum(["selected", "thread_context"]).optional() }).strict(),
  z.object({ kind: z.literal("poll"), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("note"), turnId: z.string().uuid() }).strict(),
]);
export type TurnArtifactRef = z.infer<typeof TurnArtifactRefSchema>;

/** Explicit UI actions. Absent means ordinary conversation; the dispatcher never infers a poll draft. */
export const TurnExplicitActionSchema = z.discriminatedUnion("kind", [
  ItineraryRequestSchema,
  z.object({ kind: z.literal("ask_group"), starterId: z.enum(["dates", "attendance", "stay", "question"]).nullable(), workflowKey: WorkflowKeySchema.optional() }).strict(),
  /** Only this reviewed query text may leave Commons for a public search provider. */
  z.object({ kind: z.literal("research"), query: z.string().trim().min(1).max(500) }).strict(),
  /** Choose the task a correction or cancellation applies to (answers "which task?"). `text` carries the organizer's original words. */
  TaskControlActionSchema,
]);
export type TurnExplicitAction = z.infer<typeof TurnExplicitActionSchema>;

export const TurnVoiceMetadataSchema = z.object({
  sessionId: z.string().min(1).max(120),
  delegationId: z.string().min(1).max(120),
}).strict();

export const TurnCommandSchema = z.object({
  /** Stable per human request; reused for retry and for lookup after a timeout or reload. */
  commandId: z.string().uuid(),
  target: TurnTargetSchema,
  inputMode: CoordinatorInputModeSchema,
  text: z.string().trim().min(1).max(30000),
  attachments: z.array(z.object({ id: z.string().uuid(), digest: z.string().length(64) }).strict()).max(3).optional(),
  artifact: TurnArtifactRefSchema.optional(),
  explicitAction: TurnExplicitActionSchema.optional(),
  voice: TurnVoiceMetadataSchema.optional(),
}).strict().superRefine((command, context) => {
  if ((command.inputMode === "voice") !== Boolean(command.voice)) context.addIssue({ code: "custom", path: ["voice"], message: "Voice metadata is required for voice turns only." });
  if (command.target.kind === "new" && command.artifact) context.addIssue({ code: "custom", path: ["artifact"], message: "A new conversation cannot reference an existing artifact." });
});
export type TurnCommand = z.infer<typeof TurnCommandSchema>;

// ---------------------------------------------------------------------------
// Turn result (server -> client, and delegation result -> voice)
// ---------------------------------------------------------------------------

export const TurnStatusSchema = z.enum(["pending", "completed", "failed"]);
export type TurnStatus = z.infer<typeof TurnStatusSchema>;

/** Where an answer came from, so the UI can explain it. Never includes private record contents. */
export const TurnSourceRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("trip_fact"), factId: z.string().max(80), label: z.string().max(160), version: z.union([z.number(), z.string().max(80)]) }).strict(),
  z.object({ kind: z.literal("thread"), threadId: z.string().uuid(), title: z.string().max(120), turnIds: z.array(z.string().uuid()).max(8) }).strict(),
  z.object({ kind: z.literal("research_source"), researchRunId: z.string().uuid(), sourceId: z.string().max(40), url: z.string().url().max(2048), retrievedAt: z.string().datetime() }).strict(),
  z.object({ kind: z.literal("poll"), pollId: z.string().uuid(), title: z.string().max(240) }).strict(),
]);
export type TurnSourceRef = z.infer<typeof TurnSourceRefSchema>;

// ---------------------------------------------------------------------------
// Persisted lifecycle (no schema migration): stored inside the EXISTING `coordinator_turns.workspace` jsonb
// as `workspace.lifecycle`, and thread summaries as `workspace.threadState` (docs/COORDINATOR-WORKSPACE-DESIGN.md §5).
// Absent lifecycle = a turn written before this feature = a completed text turn. Every write is validated here
// because the database has no CHECK constraints for these fields.
// ---------------------------------------------------------------------------

export const COORDINATOR_MAX_TURN_ATTEMPTS = 3;
export const COORDINATOR_MAX_SPOKEN_REPLY = 600;
export const COORDINATOR_MAX_THREAD_SUMMARY = 400;
export const COORDINATOR_MAX_OPEN_QUESTIONS = 3;
export const COORDINATOR_MAX_OPEN_QUESTION = 200;
export const COORDINATOR_MAX_THREAD_TITLE = 60;

/**
 * `assistant_text` is NOT NULL and older code (the branch base and production main) renders it verbatim, so pending and
 * failed rows carry these neutral placeholders instead of an empty string. Code that knows the lifecycle never shows them
 * as an answer; it reads `assistantText` only from completed turns.
 */
export const COORDINATOR_PENDING_TURN_TEXT = "Commons hasn't finished this reply yet. If it doesn't appear, ask again.";
export const COORDINATOR_FAILED_TURN_TEXT = "Commons couldn't finish this reply. Nothing was changed. Ask again to retry.";

export const CoordinatorTurnLifecycleSchema = z.object({
  v: z.literal(1),
  status: TurnStatusSchema,
  inputMode: CoordinatorInputModeSchema,
  errorCode: CoordinatorErrorCodeSchema.nullable(),
  attempt: z.number().int().min(1).max(COORDINATOR_MAX_TURN_ATTEMPTS),
  leaseExpiresAt: z.string().datetime().nullable(),
  spokenReply: z.string().max(COORDINATOR_MAX_SPOKEN_REPLY).nullable(),
  sources: z.array(TurnSourceRefSchema).max(20),
  completedAt: z.string().datetime().nullable(),
  /** Title given to the thread when this turn created it; lets the title source be derived without a column. */
  provisionalTitle: z.string().min(1).max(COORDINATOR_MAX_THREAD_TITLE).nullable().default(null),
}).strict().superRefine((life, ctx) => {
  const fail = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if ((life.status === "failed") !== (life.errorCode !== null)) fail("errorCode", "errorCode is set exactly when status is failed");
  if ((life.status === "pending") !== (life.leaseExpiresAt !== null)) fail("leaseExpiresAt", "a lease is set exactly while a turn is pending");
  if ((life.status === "completed") !== (life.completedAt !== null)) fail("completedAt", "completedAt is set exactly when status is completed");
  if (life.status !== "completed" && (life.spokenReply !== null || life.sources.length)) fail("spokenReply", "only completed turns carry a spoken reply or sources");
});
export type CoordinatorTurnLifecycle = z.infer<typeof CoordinatorTurnLifecycleSchema>;

/** Latest state wins; a turn writes it only when it changes the thread summary, open questions, or generated title. */
export const CoordinatorThreadStateSchema = z.object({
  v: z.literal(1),
  summary: z.string().max(COORDINATOR_MAX_THREAD_SUMMARY).nullable(),
  summaryTurnVersion: z.number().int().nonnegative().nullable(),
  openQuestions: z.array(z.string().max(COORDINATOR_MAX_OPEN_QUESTION)).max(COORDINATOR_MAX_OPEN_QUESTIONS),
  generatedTitle: z.string().min(1).max(COORDINATOR_MAX_THREAD_TITLE).nullable(),
}).strict();
export type CoordinatorThreadState = z.infer<typeof CoordinatorThreadStateSchema>;

/** Rules the removed CHECK constraints used to enforce on the row as a whole. Throws on violation. */
export function assertCoordinatorTurnRowInvariants(row: { assistantText: string; lifecycle: CoordinatorTurnLifecycle }) {
  CoordinatorTurnLifecycleSchema.parse(row.lifecycle);
  if (row.lifecycle.status === "completed" && !row.assistantText.trim()) throw new Error("A completed coordinator turn needs a non-empty answer.");
}

export const TurnArtifactResultSchema = z.object({
  kind: z.enum(["poll_draft", "draft_edit_proposal", "trip_change_proposal", "trip_task_proposal", "itinerary_draft", "expense_review", "research_run", "attendance_receipt", "linked_idea", "thread"]),
  id: z.string().uuid(),
  /** Always the ORIGIN thread of the command, even if the client navigated away meanwhile. */
  threadId: z.string().uuid(),
  version: z.number().int().positive().nullable(),
  reviewRequired: z.boolean(),
  /** Direct actions (attendance) are undoable from their receipt. */
  undoable: z.boolean(),
}).strict();
export type TurnArtifactResult = z.infer<typeof TurnArtifactResultSchema>;

export const TurnNavigationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("switched"), threadId: z.string().uuid(), title: z.string().max(120) }).strict(),
  z.object({ kind: z.literal("created"), threadId: z.string().uuid(), title: z.string().max(120) }).strict(),
  z.object({ kind: z.literal("clarify"), candidates: z.array(z.object({ threadId: z.string().uuid(), title: z.string().max(120), /** Short secondary label ("this conversation", "last active Sep 29, 2:15 PM · 3 messages") so candidates never look identical. */ detail: z.string().max(100).optional() }).strict()).min(2).max(4) }).strict(),
]);
export type TurnNavigation = z.infer<typeof TurnNavigationSchema>;

/** The capability that produced the result. `unsupported` is an honest refusal; nothing changed. */
export const TurnCapabilitySchema = z.enum(["answer", "retrieve_context", "research", "prepare_poll", "prepare_expense", "propose_trip_change", "link_idea", "record_attendance", "invite_people", "add_activities", "navigate_thread", "steer_task", "unsupported"]);
export type TurnCapability = z.infer<typeof TurnCapabilitySchema>;

export const TurnResultSchema = z.object({
  commandId: z.string().uuid(),
  status: TurnStatusSchema,
  /** The saved human turn. Present whenever the request itself was persisted. */
  turnId: z.string().uuid().nullable(),
  /** Which capability handled the request; null while pending or failed before routing. */
  capability: TurnCapabilitySchema.nullable().default(null),
  thread: z.object({
    id: z.string().uuid(), title: z.string().min(1).max(120),
    /** Turn sequence after this command; send it as `expectedTurnVersion` next time. */
    turnVersion: z.number().int().nonnegative(),
    /** Thread metadata version (title/status), used by rename/archive. */
    metadataVersion: z.number().int().positive(),
  }).strict().nullable(),
  /** Short, listenable reply (<= ~3 sentences). Null while pending or when failed. */
  spokenReply: z.string().max(600).nullable(),
  /** The durable reply saved in the thread. */
  durableAnswer: z.string().max(4000).nullable(),
  sources: z.array(TurnSourceRefSchema).max(20),
  artifacts: z.array(TurnArtifactResultSchema).max(8),
  reviewRequired: z.boolean(),
  navigation: TurnNavigationSchema.nullable(),
  /** What persisted, independent of whether anything was applied or shared (R7). */
  saved: z.object({ request: z.boolean(), answer: z.boolean(), proposal: z.boolean() }).strict(),
  /** Conversation content is never shared. Standard invitation emails contain no chat content. */
  shared: z.literal(false),
  error: CoordinatorErrorSchema.nullable(),
}).strict().superRefine((result, context) => {
  if ((result.status === "failed") !== Boolean(result.error)) context.addIssue({ code: "custom", path: ["error"], message: "Failed results carry exactly one error." });
  if (result.status === "completed" && !result.durableAnswer) context.addIssue({ code: "custom", path: ["durableAnswer"], message: "Completed results carry a durable answer." });
});
export type TurnResult = z.infer<typeof TurnResultSchema>;

// ---------------------------------------------------------------------------
// Streamed turn events (server -> client, `text/event-stream` on POST /turns)
// ---------------------------------------------------------------------------

/**
 * Server phases a turn actually passes through. Labels come from these, never from a timer: no percentages, no simulated typing.
 * `context` = reading saved trip details; `searching` = public web search; `writing` = the model is producing the reply;
 * `preparing` = a proposal or draft is being built and checked; `saving` = the outcome is being committed.
 */
export const TurnPhaseSchema = z.enum(["context", "searching", "writing", "preparing", "saving"]);
export type TurnPhase = z.infer<typeof TurnPhaseSchema>;

const streamBase = { commandId: z.string().uuid(), seq: z.number().int().nonnegative() };

/**
 * One typed event per SSE message. `seq` increases by one per command, so a client drops repeats and never applies an older event after a newer one.
 * `text` carries the WHOLE reply shown so far (not an increment), so a repeated or late event can never garble it. It has passed the same sentence-level
 * honesty guard as the saved reply and is a prefix of it; it is provisional until `completed`, whose result is authoritative and replaces it. Proposals, drafts and receipts appear only in `completed` (after validation and commit), never as partial output.
 */
export const TurnStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("accepted"), ...streamBase, turnId: z.string().uuid(), threadId: z.string().uuid(), replayed: z.boolean() }).strict(),
  z.object({ type: z.literal("phase"), ...streamBase, phase: TurnPhaseSchema }).strict(),
  z.object({ type: z.literal("text"), ...streamBase, text: z.string().min(1).max(4000) }).strict(),
  z.object({ type: z.literal("completed"), ...streamBase, result: TurnResultSchema }).strict(),
  /** Nothing was saved (auth, membership, stale version, rate limit ...): the same error the JSON route returns with its HTTP status. */
  z.object({ type: z.literal("rejected"), ...streamBase, error: CoordinatorErrorSchema, status: z.number().int().min(400).max(599) }).strict(),
]);
export type TurnStreamEvent = z.infer<typeof TurnStreamEventSchema>;

// ---------------------------------------------------------------------------
// Authorized trip context snapshot (R2)
// ---------------------------------------------------------------------------

/** Precedence, strongest first. See the design doc's fact precedence policy. */
export const FactProvenanceKindSchema = z.enum(["saved_record", "approved_decision", "poll_preference", "pending_proposal", "thread_discussion", "current_turn"]);

export const FactProvenanceSchema = z.object({
  kind: FactProvenanceKindSchema,
  recordType: z.enum(["trip", "membership", "stay", "itinerary_item", "travel_plan", "budget", "expense_summary", "poll", "poll_decision", "proposal", "coordinator_turn", "coordinator_thread", "trip_task"]),
  recordId: z.string().max(80).nullable(),
  /** Set for thread-derived facts: tentative ideas stay attributed to their source thread. */
  threadId: z.string().uuid().nullable(),
  /** Display attribution only (for example "Added by Casey"); never an email or contact detail. */
  label: z.string().max(160).nullable(),
}).strict();

export const FactFreshnessSchema = z.object({
  /** When the server read this fact for this turn. */
  asOf: z.string().datetime(),
  /** Last change of the underlying record, when known. */
  updatedAt: z.string().datetime().nullable(),
}).strict();

function fact<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    /** Stable identifier such as "trip", "stay:<uuid>", "traveler:<uuid>". */
    id: z.string().min(1).max(80),
    /** Row version or updatedAt fingerprint, so proposals can detect staleness. */
    version: z.union([z.number().int().nonnegative(), z.string().max(80)]),
    provenance: FactProvenanceSchema,
    freshness: FactFreshnessSchema,
    value,
  }).strict();
}

export const TripContextUnknownSchema = z.enum(["dates", "destination", "stay", "budget", "attendance", "plans", "travel_logistics"]);

export const ThreadIndexEntrySchema = z.object({
  threadId: z.string().uuid(),
  title: z.string().min(1).max(120),
  status: z.enum(["active", "archived"]),
  /** Bounded, model-maintained summary of tentative discussion; attributed to this thread, never promoted to a trip fact. */
  summary: z.string().max(400).nullable(),
  /** Turn sequence the summary reflects; older than turnVersion means the summary may be behind. */
  summaryTurnVersion: z.number().int().nonnegative().nullable(),
  turnVersion: z.number().int().nonnegative(),
  openQuestions: z.array(z.string().max(200)).max(3),
  /** Derived from records (published polls with decisions, applied proposals, linked ideas), never from model prose. */
  approvedOutcomes: z.array(z.object({ kind: z.enum(["poll_decision", "applied_trip_change", "linked_idea"]), refId: z.string().uuid(), label: z.string().max(160) }).strict()).max(8),
  artifactCounts: z.object({ drafts: z.number().int().nonnegative(), polls: z.number().int().nonnegative(), research: z.number().int().nonnegative(), linkedIdeas: z.number().int().nonnegative() }).strict(),
  lastActivityAt: z.string().datetime(),
}).strict();
export type ThreadIndexEntry = z.infer<typeof ThreadIndexEntrySchema>;

export const CapabilityIdSchema = z.enum([
  "answer", // advice and questions over authorized context
  "retrieve_context", // read another thread or trip facts on demand
  "research", // bounded public web research with sources
  "prepare_poll", // explicit Ask the group: private draft + proposal; publication is separate
  "propose_trip_change", // budget/dates/destination/stay/plan proposals for review
  "link_idea", // link an existing Plan idea to a thread (no copy)
  "invite_people", // explicit address list queues Traveler invitations
  "add_activities", // explicit title list saves undated, unconfirmed activity ideas
  "prepare_expense", // named activity opens the existing expense review; no spending recorded
  "record_attendance", // direct-attendance exception with receipt + Undo
  "navigate_thread", // open / continue in / start a separate thread
  "steer_task", // status, correction or cancellation of a durable task (continuity), or starting one
]);
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;

export const TripContextSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  tripId: z.string().uuid(),
  assembledAt: z.string().datetime(),
  /** Only active organizers receive a snapshot in this release. */
  audience: z.literal("active_organizers"),
  trip: fact(z.object({ name: z.string().max(200), destination: z.string().max(160).nullable(), startsOn: z.string().date().nullable(), endsOn: z.string().date().nullable(), timezone: z.string().max(64), currency: z.string().regex(/^[A-Z]{3}$/).optional(), planningPreferences: TripPlanningContextSchema.optional() }).strict()),
  /** invited vs attending stay distinct. No emails, phones, or traveler-profile preferences. */
  travelers: z.array(fact(z.object({
    personId: z.string().uuid(), name: z.string().max(160), role: z.enum(["organizer", "member"]),
    membership: z.enum(["active", "invited"]), managed: z.boolean(),
    attendance: z.enum(["attending", "declined", "helping", "unknown"]), attendanceDates: z.string().max(200).nullable(),
  }).strict())).max(60),
  /** Reported booking status is not verified availability; cost kind distinguishes estimates from confirmations. */
  stays: z.array(fact(z.object({
    stayId: z.string().uuid(), name: z.string().max(160), address: z.string().max(240),
    startsOn: z.string().date(), endsOn: z.string().date(), timezone: z.string().nullable().optional(), checkInTime: z.string().max(20).nullable(), checkOutTime: z.string().max(20).nullable(),
    status: z.enum(["considering", "planned", "confirmed"]), bookingReportedByOrganizer: z.boolean(), availabilityVerified: z.literal(false),
    costCents: z.number().int().nonnegative().nullable(), costKind: z.enum(["estimate", "confirmation", "expense"]).nullable(), currency: z.string().length(3),
    includedPersonIds: z.array(z.string().uuid()).max(60),
  }).strict())).max(10),
  plans: z.array(fact(z.object({
    itemId: z.string().uuid(), title: z.string().max(200), status: z.enum(["idea", "planned", "confirmed"]),
    sourceUrl: z.string().url().max(2048).nullable().optional(),
    scheduledDate: z.string().date().nullable().optional(), startsAt: z.string().datetime().nullable(), location: z.string().max(240).nullable(), participantScope: z.string().max(40),
  }).strict())).max(40),
  /** Only travel plans shared beyond private visibility; no confirmation codes or booking references. */
  logistics: z.array(fact(z.object({
    travelPlanId: z.string().uuid(), travelerIds: z.array(z.string().uuid()).max(20), kind: z.string().max(40),
    visibility: z.enum(["private", "basic", "all"]).optional(),
    route: z.string().max(120).optional(), date: z.string().date().optional(), localTime: z.string().nullable().optional(), connections: z.array(FlightConnectionSchema).max(8).optional(),
    status: z.enum(["considering", "booked", "confirmed"]), arrivesAt: z.string().datetime().nullable(), departsAt: z.string().datetime().nullable(),
  }).strict())).max(40),
  tasks: z.array(fact(z.object({ taskId: z.string().uuid(), title: z.string().max(160), ownerPersonId: z.string().uuid(), dueOn: z.string().date().nullable(), completed: z.boolean(), itemKind: z.enum(["plan", "travel", "stay"]).nullable(), itemId: z.string().uuid().nullable() }).strict())).max(40).default([]),
  /** Expected (target) versus actual (recorded) money; no balances or per-person amounts. */
  budget: fact(z.object({ targetTotalCents: z.number().int().positive().nullable(), recordedExpenseTotalCents: z.number().int().nonnegative(), recordedExpenseCount: z.number().int().nonnegative(), currency: z.string().length(3), recordedByCurrency: z.array(z.object({ currency: z.string().length(3), totalCents: z.number().int().nonnegative(), count: z.number().int().nonnegative() })).optional() }).strict()),
  /** A poll preference is not a decision; `decision` is set only when an organizer approved one. */
  polls: z.array(fact(z.object({
    pollId: z.string().uuid(), title: z.string().max(240), status: z.enum(["open", "closed"]), threadId: z.string().uuid().nullable(),
    responseCount: z.number().int().nonnegative(), resultsVisible: z.boolean(), leadingOption: z.string().max(240).nullable(),
    decision: z.object({ summary: z.string().max(500), approvedAt: z.string().datetime(), approvedByName: z.string().max(160) }).strict().nullable(),
  }).strict())).max(20),
  /** Organizer-only input explicitly submitted to food Goals; never traveler-profile data or public research input. */
  foodPreferences: z.array(fact(z.object({
    runId: z.string().uuid(), pollId: z.string().uuid(), title: z.string().max(120), status: z.enum(["open", "closed"]),
    roundState: z.enum(["current", "earlier"]).optional(), replacementState: z.enum(["private_draft", "published_round"]).nullable().optional(), historyIncomplete: z.boolean().optional(),
    responseCount: z.number().int().nonnegative(), omittedResponses: z.number().int().nonnegative(),
    entries: z.array(z.object({ responseId: z.string().uuid(), name: z.string().max(160), requirements: z.string().max(1000).nullable(), preferences: z.string().max(1000).nullable(), notes: z.string().max(1000).nullable(), truncated: z.boolean() }).strict()).max(60),
  }).strict())).max(20).default([]),
  /** Proposed, not applied. */
  pendingProposals: z.array(fact(z.object({
    turnId: z.string().uuid(), threadId: z.string().uuid().nullable(), kind: z.enum(["trip_change", "draft_edit"]), summary: z.string().max(240), baseVersion: z.number().int().positive(),
  }).strict())).max(10),
  threads: z.array(ThreadIndexEntrySchema).max(40),
  capabilities: z.array(CapabilityIdSchema),
  /** Explicitly missing facts: say "not saved yet" instead of inventing or re-asking settled facts. */
  unknowns: z.array(TripContextUnknownSchema),
  /** Same narrow saved anchors used by itinerary approval; independent of UI row windows. */
  itineraryAnchors: z.object({ facts: ItineraryFactsSchema, factsFingerprint: z.string().length(64), complete: z.boolean() }).strict().optional(),
}).strict();
export type TripContextSnapshot = z.infer<typeof TripContextSnapshotSchema>;

// ---------------------------------------------------------------------------
// Capability registry and dispatcher (R5)
// ---------------------------------------------------------------------------

/** Direct human commands are bounded exceptions; model-proposed changes always require review. */
export const CapabilityEffectSchema = z.enum(["none", "evidence", "proposal", "direct_with_undo", "navigation", "workspace_link", "task", "invitation", "activity"]);
export type CapabilityEffect = z.infer<typeof CapabilityEffectSchema>;

export const ModelTierSchema = z.enum(["none", "extraction", "conversation", "planning", "synthesis"]);
export type ModelTier = z.infer<typeof ModelTierSchema>;

export type CapabilityDefinition = {
  id: CapabilityId;
  effect: CapabilityEffect;
  inputModes: readonly CoordinatorInputMode[];
  /** Commons-proposed changes always require review; publication/sharing keeps its own approval. */
  reviewRequired: boolean;
  modelTier: ModelTier;
  /** True when it can only run from an explicit organizer request or UI action, never model inference alone. */
  explicitOnly: boolean;
};

/**
 * The registry. Stage 4 dispatches only through these entries; adding a
 * capability means adding a row here plus a handler and tests.
 */
export const coordinatorCapabilityRegistry = {
  answer: { id: "answer", effect: "none", inputModes: ["text", "voice"], reviewRequired: false, modelTier: "conversation", explicitOnly: false },
  // Evidence assembly is deterministic; the grounded answer over it uses the cheapest supported model (tier "extraction").
  retrieve_context: { id: "retrieve_context", effect: "none", inputModes: ["text", "voice"], reviewRequired: false, modelTier: "extraction", explicitOnly: false },
  research: { id: "research", effect: "evidence", inputModes: ["text", "voice"], reviewRequired: false, modelTier: "synthesis", explicitOnly: true },
  prepare_poll: { id: "prepare_poll", effect: "proposal", inputModes: ["text", "voice"], reviewRequired: true, modelTier: "conversation", explicitOnly: true },
  propose_trip_change: { id: "propose_trip_change", effect: "proposal", inputModes: ["text", "voice"], reviewRequired: true, modelTier: "extraction", explicitOnly: true },
  link_idea: { id: "link_idea", effect: "workspace_link", inputModes: ["text", "voice"], reviewRequired: false, modelTier: "none", explicitOnly: true },
  invite_people: { id: "invite_people", effect: "invitation", inputModes: ["text", "voice"], reviewRequired: false, modelTier: "none", explicitOnly: true },
  add_activities: { id: "add_activities", effect: "activity", inputModes: ["text", "voice"], reviewRequired: false, modelTier: "none", explicitOnly: true },
  prepare_expense: { id: "prepare_expense", effect: "workspace_link", inputModes: ["text", "voice"], reviewRequired: true, modelTier: "none", explicitOnly: true },
  record_attendance: { id: "record_attendance", effect: "direct_with_undo", inputModes: ["text", "voice"], reviewRequired: false, modelTier: "none", explicitOnly: true },
  navigate_thread: { id: "navigate_thread", effect: "navigation", inputModes: ["text", "voice"], reviewRequired: false, modelTier: "none", explicitOnly: true },
  // Reads and changes only a task's brief revision (never trip records). Natural-language targeting uses one small extraction call, only while tasks are active.
  steer_task: { id: "steer_task", effect: "task", inputModes: ["text", "voice"], reviewRequired: false, modelTier: "extraction", explicitOnly: false },
} as const satisfies { [K in CapabilityId]: CapabilityDefinition & { id: K } };

/** Intent after deterministic routing; the model may only choose among conversational capabilities. */
export const RoutedIntentSchema = z.discriminatedUnion("capability", [
/** `limitNotice` = the message also asked for something Commons cannot do (book, pay, calendar, send); the answer states that limit first, then helps with the underlying need. */
  /** `offer` = the wording might be a request for a group poll but was not explicit; the model answers and offers once, and nothing is created. */
  z.object({ capability: z.literal("answer"), limitNotice: z.enum(["booking", "payment", "calendar_write", "external_message"]).optional(), offer: z.literal("poll").optional() }).strict(),
  /** `threadIds` = other threads to read on demand (attributed, never promoted); `ambiguousThreadIds` (>= 2) = the referent is unclear, so one clarification is asked and nothing is read. Both empty = ground the answer in saved trip facts only. */
  z.object({ capability: z.literal("retrieve_context"), threadIds: z.array(z.string().uuid()).max(2), ambiguousThreadIds: z.array(z.string().uuid()).max(4).default([]) }).strict(),
  z.object({ capability: z.literal("research"), query: z.string().trim().min(1).max(500), querySource: z.enum(["organizer_typed", "sanitized_from_request"]) }).strict(),
  z.object({ capability: z.literal("prepare_poll"), starterId: z.enum(["dates", "attendance", "stay", "question"]).nullable() }).strict(),
  z.object({ capability: z.literal("propose_trip_change"), requestText: z.string().max(2000) }).strict(),
  /** `itineraryItemId` null = the named idea is missing or ambiguous; the handler asks one clarification. */
  z.object({ capability: z.literal("link_idea"), itineraryItemId: z.string().uuid().nullable(), candidateItemIds: z.array(z.string().uuid()).max(4).default([]) }).strict(),
  z.object({ capability: z.literal("invite_people") }).strict(),
  z.object({ capability: z.literal("add_activities") }).strict(),
  z.object({ capability: z.literal("prepare_expense") }).strict(),
  z.object({ capability: z.literal("record_attendance") }).strict(),
  z.object({ capability: z.literal("navigate_thread"), action: z.enum(["open", "continue_in", "start_separate"]), targetThreadId: z.string().uuid().nullable(), candidateThreadIds: z.array(z.string().uuid()).max(4), title: z.string().max(120).nullable() }).strict(),
  z.object({ capability: z.literal("unsupported"), reason: z.enum(["booking", "payment", "calendar_write", "external_message", "thread_merge_or_split", "move_messages", "voice_approval", "approval_in_chat", "research_query_unsafe", "research_contact_lookup", "plan_updates_off", "other"]), planStatus: z.enum(["confirmed", "cancelled"]).nullable().optional() }).strict(),
]);
export type RoutedIntent = z.infer<typeof RoutedIntentSchema>;

/** What a capability returns before persistence; the turn service maps it to a TurnResult. */
export type CapabilityOutcome = {
  status: "completed" | "failed";
  durableAnswer: string;
  spokenReply: string;
  sources: TurnSourceRef[];
  artifacts: TurnArtifactResult[];
  reviewRequired: boolean;
  navigation: TurnNavigation | null;
  error: CoordinatorError | null;
  /** Bounded thread metadata the same inference may maintain (no extra billable call). */
  threadUpdate?: { topicTitle?: string; summary?: string; openQuestions?: string[] };
};

export const CoordinatorStyleSchema = CoordinatorPersonalityIdSchema;
