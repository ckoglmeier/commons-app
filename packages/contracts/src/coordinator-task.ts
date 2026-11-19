import { z } from "zod";

/*
 * Steerable coordinator tasks (docs/COORDINATOR-CONTINUITY-REVIEW.md). A task is a durable, bounded piece of read-only work (public-source research) with a
 * brief that carries a revision. These shapes carry no authority: every operation is re-authorized and revision-checked in the database.
 */

export const TASK_TITLE_MAX = 120;
export const TASK_BRIEF_MAX = 1000;
export const TASK_NOTE_MAX = 500;

export const TaskStatusSchema = z.enum(["queued", "running", "needs_input", "succeeded", "failed", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/** The compact, organizer-visible state of one task. Never contains provider output beyond the saved result's own id. */
export const CoordinatorTaskSchema = z.object({
  taskId: z.string().uuid(), threadId: z.string().uuid(),
  title: z.string().max(TASK_TITLE_MAX), brief: z.string().max(2000), revision: z.number().int().positive(),
  status: TaskStatusSchema, errorCode: z.string().nullable(),
  waitingForSlot: z.boolean(), needsInput: z.string().nullable(),
  /** A result exists but answers an earlier revision of the brief. */
  resultOutdated: z.boolean(), hasResult: z.boolean(),
  currentRunId: z.string().uuid().nullable(), runIds: z.array(z.string().uuid()),
  ownedByMe: z.boolean(), requestedByName: z.string(),
  acceptedAt: z.string().datetime(), updatedAt: z.string().datetime(),
  lastChange: z.object({ kind: z.enum(["started", "amended", "cancelled", "completed", "failed"]), revision: z.number().int().positive(), at: z.string().datetime(), summary: z.string().nullable() }).nullable(),
  steered: z.boolean(),
}).strict();
export type CoordinatorTask = z.infer<typeof CoordinatorTaskSchema>;
export const CoordinatorTasksSchema = z.array(CoordinatorTaskSchema);

export const StartTaskRequestSchema = z.object({
  op: z.literal("start"), commandId: z.string().uuid(), threadId: z.string().uuid(),
  title: z.string().trim().min(1).max(TASK_TITLE_MAX),
  /** What the task is for, in the organizer's words. Stays in Commons: only `query` leaves for a public search provider. */
  brief: z.string().trim().max(TASK_BRIEF_MAX).default(""),
  /** The reviewed public search query. */
  query: z.string().trim().min(1).max(500),
}).strict();
export const AmendTaskRequestSchema = z.object({
  op: z.literal("amend"), commandId: z.string().uuid(), threadId: z.string().uuid(), taskId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  note: z.string().trim().min(1).max(TASK_NOTE_MAX),
  /** Optional replacement for the public search query, reviewed by the organizer. */
  query: z.string().trim().min(1).max(500).optional(),
}).strict();
export const CancelTaskRequestSchema = z.object({
  op: z.literal("cancel"), commandId: z.string().uuid(), threadId: z.string().uuid(), taskId: z.string().uuid(),
}).strict();
export const TaskOperationRequestSchema = z.discriminatedUnion("op", [StartTaskRequestSchema, AmendTaskRequestSchema, CancelTaskRequestSchema]);
export type TaskOperationRequest = z.infer<typeof TaskOperationRequestSchema>;

/** An explicit choice of task made in the UI (for example answering "which task?"). Bypasses model classification. */
export const TaskControlActionSchema = z.object({
  kind: z.literal("task_control"), op: z.enum(["amend", "cancel"]),
  taskId: z.string().uuid(), expectedRevision: z.number().int().positive(),
}).strict();

const taskRef = z.object({ taskId: z.string().uuid(), title: z.string().max(TASK_TITLE_MAX), revision: z.number().int().positive() }).strict();

/**
 * What a turn did about tasks, saved with the turn so a reload shows the same receipt. Stated by code from the database result, never by model prose.
 * `message` (clarify) is the organizer's original words, kept so the choice can be applied to exactly what they said.
 */
export const TurnSteeringSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started"), ...taskRef.shape, status: TaskStatusSchema }).strict(),
  z.object({ kind: z.literal("amended"), ...taskRef.shape, status: TaskStatusSchema, supersededRunning: z.boolean(), needsInput: z.string().nullable(), replayed: z.boolean().default(false) }).strict(),
  z.object({ kind: z.literal("cancelled"), ...taskRef.shape, status: TaskStatusSchema, cancelled: z.boolean() }).strict(),
  z.object({ kind: z.literal("status"), tasks: z.array(z.object({ ...taskRef.shape, status: TaskStatusSchema, needsInput: z.string().nullable(), resultOutdated: z.boolean() }).strict()).max(8) }).strict(),
  z.object({ kind: z.literal("clarify"), operation: z.enum(["amend", "cancel"]), message: z.string().max(2000), candidates: z.array(taskRef).min(2).max(6) }).strict(),
  z.object({ kind: z.literal("suggest_task"), title: z.string().max(TASK_TITLE_MAX), query: z.string().max(500) }).strict(),
  z.object({ kind: z.literal("conflict"), ...taskRef.shape, currentRevision: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("unavailable"), reason: z.enum(["runner", "provider", "limit", "not_yours", "not_found"]) }).strict(),
]);
export type TurnSteering = z.infer<typeof TurnSteeringSchema>;

/** The model's reading of a follow-up while tasks are active. Advisory: code validates the target and the actor before anything changes. */
export const FollowUpReadingSchema = z.object({
  operation: z.enum(["none", "status", "amend", "cancel", "new_task"]),
  /** One task id from the supplied list, or null when no single task is meant. */
  taskId: z.string().nullable(),
  /** Task ids from the supplied list that plausibly match when no single one is clear. */
  candidateTaskIds: z.array(z.string()).max(6),
  /** For amend: the change itself, in neutral wording, with only what the organizer stated. */
  change: z.string().max(TASK_NOTE_MAX).nullable(),
  /** For amend: a fact the task needs and the organizer has not given (for example an arrival time), or null. */
  missingFact: z.string().max(300).nullable(),
  /** For new_task: a short title and a public, non-private search query. */
  title: z.string().max(TASK_TITLE_MAX).nullable(),
}).strict();
export type FollowUpReading = z.infer<typeof FollowUpReadingSchema>;

/** Subthread (optional) and main conversation. */
export const StartSubthreadRequestSchema = z.object({
  commandId: z.string().uuid(), parentThreadId: z.string().uuid(), threadId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(120), brief: z.string().trim().max(1000).default(""),
  briefTaskIds: z.array(z.string().uuid()).max(6).default([]),
}).strict();
export const LinkOutcomeRequestSchema = z.object({ taskId: z.string().uuid(), revision: z.number().int().positive() }).strict();
export const ThreadRelationSchema = z.object({
  kind: z.enum(["main", "sub", "task"]), parentThreadId: z.string().uuid().nullable(), brief: z.string().nullable(), briefTaskIds: z.array(z.string().uuid()),
}).strict();
export type ThreadRelation = z.infer<typeof ThreadRelationSchema>;
export const ThreadOutcomeSchema = z.object({
  id: z.string().uuid(), sourceThreadId: z.string().uuid(), sourceTitle: z.string(), taskId: z.string().uuid(), taskRevision: z.number().int().positive(), summary: z.string(), at: z.string().datetime(),
}).strict();
export type ThreadOutcome = z.infer<typeof ThreadOutcomeSchema>;
