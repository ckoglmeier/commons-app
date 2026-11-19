import { z } from "zod";

/*
 * Task goals (docs/COORDINATOR-TASK-AGENTS-PLAN.md). A goal is the durable unit an organizer sees as a "task": a title, a goal and finish line, one focused
 * conversation, and an ordered handful of typed steps that reuse existing machinery (research runs, polls, reviewed Plan proposals, participant outreach).
 * These shapes carry no authority. Every operation is re-authorized and revision-checked in the database, and a model may only propose steps: it cannot
 * grant a tool, widen a recipient, raise a budget, or approve itself.
 */

export const GOAL_TITLE_MAX = 120;
export const GOAL_TEXT_MAX = 1000;
export const GOAL_CRITERION_MAX = 400;
export const GOAL_NOTE_MAX = 500;
export const GOAL_MAX_STEPS = 4;

/** The five-part taxonomy. `book` exists so the contract is complete, and is refused everywhere in this release. */
export const GoalKindSchema = z.enum(["research", "poll", "planning", "plan_action", "participant", "book"]);
export type GoalKind = z.infer<typeof GoalKindSchema>;
export const ENABLED_GOAL_KINDS = ["research", "poll", "plan_action", "participant"] as const satisfies readonly GoalKind[];

export const GoalLifecycleSchema = z.enum(["ready", "running", "waiting_for_input", "waiting_for_approval", "waiting_for_event", "completed", "failed", "cancelled"]);
export type GoalLifecycle = z.infer<typeof GoalLifecycleSchema>;
export const GOAL_TERMINAL = ["completed", "failed", "cancelled"] as const satisfies readonly GoalLifecycle[];
export const GOAL_WAITING = ["waiting_for_input", "waiting_for_approval", "waiting_for_event"] as const satisfies readonly GoalLifecycle[];
export const isGoalTerminal = (lifecycle: GoalLifecycle) => (GOAL_TERMINAL as readonly string[]).includes(lifecycle);
export const isGoalWaiting = (lifecycle: GoalLifecycle) => (GOAL_WAITING as readonly string[]).includes(lifecycle);

export const GoalStepKindSchema = z.enum(["research", "poll", "planning", "plan_action", "outreach"]);
export type GoalStepKind = z.infer<typeof GoalStepKindSchema>;
export const GoalStepStatusSchema = z.enum(["pending", "running", "waiting", "done", "failed", "cancelled", "superseded"]);
export type GoalStepStatus = z.infer<typeof GoalStepStatusSchema>;

/** How a poll-collection step decides it has heard enough. Link polls can never claim that named people answered. */
export const PollCompletionRuleSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all_invited") }).strict(),
  z.object({ mode: z.literal("count"), count: z.number().int().min(1).max(500) }).strict(),
  z.object({ mode: z.literal("deadline"), at: z.string().datetime() }).strict(),
  z.object({ mode: z.literal("manual") }).strict(),
]);
export type PollCompletionRule = z.infer<typeof PollCompletionRuleSchema>;

export const GoalStepParamsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("research"), query: z.string().trim().min(1).max(500) }).strict(),
  z.object({ kind: z.literal("poll"), pollId: z.string().uuid().nullable().default(null), rule: PollCompletionRuleSchema.default({ mode: "manual" }) }).strict(),
  z.object({ kind: z.literal("plan_action"), turnId: z.string().uuid().nullable().default(null) }).strict(),
  z.object({ kind: z.literal("planning"), runId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("outreach"), recipientPersonId: z.string().uuid(), question: z.string().trim().min(1).max(300), maxFollowUps: z.number().int().min(0).max(2).default(1) }).strict(),
]);
export type GoalStepParams = z.infer<typeof GoalStepParamsSchema>;

/**
 * The delegation envelope. Built and validated by code from the capability, never accepted from a client or model. `permitted` is derived from `kind`; `budget`
 * is finite; `wake` lists the only events that may resume the goal (nothing resumes on a timer unless an authorized deadline is listed).
 */
export const GoalEnvelopeSchema = z.object({
  version: z.literal(1),
  capability: GoalKindSchema,
  audience: z.literal("organizers"),
  steps: z.array(GoalStepParamsSchema).min(1).max(GOAL_MAX_STEPS),
  contextRefs: z.array(z.object({ type: z.enum(["plan_item", "idea", "poll", "thread"]), id: z.string().uuid() }).strict()).max(12),
  permitted: z.array(z.enum(["research.public_sources", "poll.read_responses", "plan.apply_reviewed_proposal", "participant.sms.ask"])).max(4),
  wake: z.array(z.enum(["answer", "approval", "poll_response", "poll_closed", "deadline", "outreach_reply"])).max(6),
  report: z.array(z.enum(["completed", "needs_input", "needs_approval", "failed", "milestone"])).max(5),
  budget: z.object({ maxSteps: z.number().int().min(1).max(GOAL_MAX_STEPS), maxAttemptsPerStep: z.number().int().min(1).max(5), maxDurationHours: z.number().int().min(1).max(24 * 30), maxToolCalls: z.number().int().min(0).max(20), spendCents: z.literal(0) }).strict(),
  modelPolicyVersion: z.string().max(40),
}).strict();
export type GoalEnvelope = z.infer<typeof GoalEnvelopeSchema>;

// ---------------------------------------------------------------------------
// What an organizer sees
// ---------------------------------------------------------------------------

export const GoalStepViewSchema = z.object({
  seq: z.number().int().min(0), kind: GoalStepKindSchema, status: GoalStepStatusSchema, label: z.string().max(160), summary: z.string().max(400).nullable(),
  refId: z.string().uuid().nullable(),
}).strict();
export type GoalStepView = z.infer<typeof GoalStepViewSchema>;

export const GoalOutcomeSchema = z.object({
  /** What finished it: a sourced result, a poll tally, an applied receipt, a participant's statement, or a stated limit. */
  kind: z.enum(["research", "poll", "planning_decision", "plan_receipt", "participant_statement", "limited"]),
  headline: z.string().max(240), detail: z.string().max(1200).nullable(),
  sources: z.array(z.object({ title: z.string().max(160), url: z.string().url().nullable() }).strict()).max(12),
  unknowns: z.array(z.string().max(240)).max(8),
  /** Stated by code from the stored result. For an applied change: the object, the human approver and the resulting version. */
  receipt: z.object({ object: z.string().max(160), approvedBy: z.string().max(120), version: z.string().max(80).nullable(), at: z.string().datetime() }).strict().nullable(),
  retrievedAt: z.string().datetime().nullable(),
}).strict();
export type GoalOutcome = z.infer<typeof GoalOutcomeSchema>;

export const CoordinatorGoalSchema = z.object({
  goalId: z.string().uuid(), threadId: z.string().uuid(), mainThreadId: z.string().uuid(),
  kind: GoalKindSchema, title: z.string().max(GOAL_TITLE_MAX), goal: z.string().max(2000), completionCriterion: z.string().max(GOAL_CRITERION_MAX),
  revision: z.number().int().positive(), lifecycle: GoalLifecycleSchema,
  /** The question or approval being waited on, in plain words. Null unless waiting. */
  waitDetail: z.string().max(400).nullable(),
  /** Display-only state derived from the linked saved workflow. Execution approval remains separate. */
  planning: z.object({ runId: z.string().uuid(), stage: z.string(), label: z.string(), nextAction: z.string(),
    action: z.enum(["continue_draft", "close_voting", "review_answers", "review_outcome", "view_round", "wait"]).optional(),
  }).strict().optional(),
  steps: z.array(GoalStepViewSchema).max(GOAL_MAX_STEPS * 3),
  /** Research detail for the current research step, so the existing source view keeps working. */
  research: z.object({ taskId: z.string().uuid(), status: z.string(), waitingForSlot: z.boolean(), currentRunId: z.string().uuid().nullable(), runIds: z.array(z.string().uuid()), resultOutdated: z.boolean() }).strict().nullable(),
  outcome: GoalOutcomeSchema.nullable(), outcomeRevision: z.number().int().positive().nullable(),
  errorCode: z.string().nullable(),
  /** Execution cannot start here (no confirmed runner / provider); the goal is planned, not running. */
  executionBlocked: z.enum(["runner", "provider"]).nullable(),
  ideaIds: z.array(z.string().uuid()).max(12),
  ownedByMe: z.boolean(), requestedByName: z.string(),
  legacy: z.boolean(), resultStale:z.boolean().default(false), sourceThreadId:z.string().uuid().nullable().default(null),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), completedAt: z.string().datetime().nullable(),
}).strict();
export type CoordinatorGoal = z.infer<typeof CoordinatorGoalSchema>;

export const GoalReportKindSchema = z.enum(["completed", "needs_input", "needs_approval", "failed", "milestone", "late_reply"]);
export type GoalReportKind = z.infer<typeof GoalReportKindSchema>;
export const GoalReportSchema = z.object({
  id: z.string().uuid(), goalId: z.string().uuid(), goalTitle: z.string(), threadId: z.string().uuid(), goalRevision: z.number().int().positive(), kind: GoalReportKindSchema,
  headline: z.string().max(240), detail: z.string().max(1200).nullable(), nextAction: z.string().max(240).nullable(),
  sources: z.array(z.object({ title: z.string().max(160), url: z.string().url().nullable() }).strict()).max(12),
  superseded: z.boolean(), createdAt: z.string().datetime(),
}).strict();
export type GoalReport = z.infer<typeof GoalReportSchema>;

export const GoalEventSchema = z.object({
  kind: z.string(), revision: z.number().int().positive(), at: z.string().datetime(), by: z.string().nullable(), summary: z.string().nullable(),
}).strict();
export type GoalEvent = z.infer<typeof GoalEventSchema>;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const commandId = z.string().uuid();
export const StartGoalRequestSchema = z.object({
  op: z.literal("start"), commandId,
  kind: GoalKindSchema.exclude(["book"]),
  title: z.string().trim().min(1).max(GOAL_TITLE_MAX),
  goal: z.string().trim().min(1).max(GOAL_TEXT_MAX),
  /** Optional; when blank, code writes a bounded default from the kind. */
  completionCriterion: z.string().trim().max(GOAL_CRITERION_MAX).default(""),
  /** Research: the reviewed public query (private details never leave Commons). */
  query: z.string().trim().max(500).default(""),
  /** An existing trip-scoped planning workflow; never a new copy of its polls. */
  workflowRunId: z.string().uuid().optional(),
  /** Plan ideas this goal considers. Linking never schedules or approves anything. */
  ideaIds: z.array(z.string().uuid()).max(8).default([]),
  /** The reviewed idea versions; stale suggestion briefs cannot start against changed source facts. */
  ideaVersions: z.array(z.object({ id: z.string().uuid(), version: z.string().datetime() }).strict()).max(8).default([]),
  /** Poll: how the collection step decides it has heard enough. */
  pollRule: PollCompletionRuleSchema.optional(),
  /** Participant: the single bounded question and who it goes to. */
  recipientPersonId: z.string().uuid().optional(),
  question: z.string().trim().max(300).optional(),
  /** Chain research before a poll or proposal step (research → poll → plan_action). Order is fixed by code; this only opts into the steps. */
  then: z.array(z.enum(["poll", "plan_action"])).max(2).default([]),
}).strict();
export const AmendGoalRequestSchema = z.object({ op: z.literal("amend"), commandId, goalId: z.string().uuid(), expectedRevision: z.number().int().positive(), note: z.string().trim().min(1).max(GOAL_NOTE_MAX), missingFact: z.string().trim().min(1).max(300).optional(), query: z.string().trim().min(1).max(500).optional() }).strict();
/** Replace the objective, not an appended conversation note. Execution requires a fresh scoped continuation. */
export const EditGoalRequestSchema = z.object({ op: z.literal("edit_goal"), commandId, goalId: z.string().uuid(), expectedRevision: z.number().int().positive(), goal: z.string().trim().min(1).max(GOAL_TEXT_MAX), completionCriterion: z.string().trim().min(1).max(GOAL_CRITERION_MAX) }).strict();
export const AnswerGoalRequestSchema = z.object({ op: z.literal("answer"), commandId, goalId: z.string().uuid(), expectedRevision: z.number().int().positive(), answer: z.string().trim().min(1).max(GOAL_NOTE_MAX), query: z.string().trim().min(1).max(500).optional() }).strict();
export const CancelGoalRequestSchema = z.object({ op: z.literal("cancel"), commandId, goalId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict();
export const ReopenGoalRequestSchema = z.object({ op: z.literal("reopen"), commandId, goalId: z.string().uuid(), expectedRevision: z.number().int().positive(), note: z.string().trim().max(GOAL_NOTE_MAX).default("") }).strict();
export const LinkPollRequestSchema = z.object({ op: z.literal("link_poll"), commandId, goalId: z.string().uuid(), expectedRevision: z.number().int().positive(), pollId: z.string().uuid(), rule: PollCompletionRuleSchema }).strict();
export const ClosePollStepRequestSchema = z.object({ op: z.literal("finish_collection"), commandId, goalId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict();
export const LinkProposalRequestSchema = z.object({ op: z.literal("link_proposal"), commandId, goalId: z.string().uuid(), expectedRevision: z.number().int().positive(), turnId: z.string().uuid() }).strict();
export const AcceptGoalOutcomeRequestSchema = z.object({ op: z.literal("accept_outcome"), commandId, goalId: z.string().uuid(), expectedRevision: z.number().int().positive(), outcomeId: z.string().uuid() }).strict();
export const GoalOperationRequestSchema = z.discriminatedUnion("op", [StartGoalRequestSchema, AmendGoalRequestSchema, EditGoalRequestSchema, AnswerGoalRequestSchema, CancelGoalRequestSchema, ReopenGoalRequestSchema, LinkPollRequestSchema, ClosePollStepRequestSchema, LinkProposalRequestSchema, AcceptGoalOutcomeRequestSchema]);
export type GoalOperationRequest = z.infer<typeof GoalOperationRequestSchema>;

/** A suggestion derived from a Plan idea. Deterministic; a suggestion never starts work. */
export const GoalSuggestionSchema = z.object({
  ideaId: z.string().uuid(), ideaTitle: z.string().max(160), kind: GoalKindSchema.exclude(["book"]),
  title: z.string().max(GOAL_TITLE_MAX), goal: z.string().max(GOAL_TEXT_MAX), completionCriterion: z.string().max(GOAL_CRITERION_MAX), query: z.string().max(500),
  /** An active goal already covers this idea and goal: offer it instead of a duplicate. */
  existingGoalId: z.string().uuid().nullable(), reason: z.string().max(240),
}).strict();
export type GoalSuggestion = z.infer<typeof GoalSuggestionSchema>;

// ---------------------------------------------------------------------------
// Participant conversation (synthetic transport only in this release)
// ---------------------------------------------------------------------------

export const OutreachStatusSchema = z.enum(["awaiting_approval", "sent", "replied", "closed", "opted_out", "timed_out", "failed"]);
export type OutreachStatus = z.infer<typeof OutreachStatusSchema>;
export const InboundParticipantEventSchema = z.object({
  /** Provider-side id, the dedupe key. */
  providerMessageId: z.string().min(1).max(120),
  /** The synthetic or provider conversation address the reply arrived on; it identifies exactly one outreach. */
  conversationAddress: z.string().min(1).max(120),
  body: z.string().max(1000), receivedAt: z.string().datetime(),
}).strict();
export type InboundParticipantEvent = z.infer<typeof InboundParticipantEventSchema>;
