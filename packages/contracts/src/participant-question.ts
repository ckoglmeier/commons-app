import { z } from "zod";

/*
 * Conversation durability lane B (docs/releases/2026-10-19/CONVERSATION-DURABILITY-BUILD-PLAN.md): one organizer-reviewed question to one traveler,
 * answered on the authenticated web. A task gives the reason to ask; the answer is attributed, reported evidence for that task's organizers. Nothing
 * here grants authority to change shared state: saving travel details or a Plan change stays a separate reviewed action.
 */

export const PARTICIPANT_QUESTION_MAX = 300;
export const PARTICIPANT_PURPOSE_MAX = 160;
export const PARTICIPANT_ANSWER_MAX = 1000;

/** What the screen shows. `waiting` = published and open; `expired` is derived from the saved expiry, never stored. */
export const ParticipantQuestionStateSchema = z.enum(["draft", "waiting", "answered", "expired", "closed", "cancelled"]);
export type ParticipantQuestionState = z.infer<typeof ParticipantQuestionStateSchema>;

const text = (max: number) => z.string().trim().min(1).max(max);

export const PrepareParticipantQuestionSchema = z.object({
  commandId: z.string().uuid(), goalId: z.string().uuid(), expectedGoalRevision: z.number().int().positive(),
  recipientPersonId: z.string().uuid(), purpose: text(PARTICIPANT_PURPOSE_MAX), question: text(PARTICIPANT_QUESTION_MAX),
  expiresInHours: z.number().int().min(1).max(168),
}).strict();
export const PublishParticipantQuestionSchema = z.object({ commandId: z.string().uuid(), questionId: z.string().uuid(), expectedVersion: z.number().int().positive() }).strict();
export const CancelParticipantQuestionSchema = z.object({ questionId: z.string().uuid() }).strict();
export const ParticipantQuestionCommandSchema = z.discriminatedUnion("action", [
  PrepareParticipantQuestionSchema.extend({ action: z.literal("prepare") }).strict(),
  PublishParticipantQuestionSchema.extend({ action: z.literal("publish") }).strict(),
  CancelParticipantQuestionSchema.extend({ action: z.literal("cancel") }).strict(),
]);
export type ParticipantQuestionCommand = z.infer<typeof ParticipantQuestionCommandSchema>;

/** The traveler's answer. `expectedAnswerRevision` is 0 for a first answer and the current revision for a correction; a stale tab is refused. */
export const AnswerParticipantQuestionSchema = z.object({
  submissionId: z.string().uuid(), body: text(PARTICIPANT_ANSWER_MAX), expectedAnswerRevision: z.number().int().min(0),
}).strict();
export type AnswerParticipantQuestion = z.infer<typeof AnswerParticipantQuestionSchema>;

const person = z.object({ personId: z.string().uuid(), name: z.string().max(160) }).strict();
const answer = z.object({ revision: z.number().int().positive(), body: z.string().max(PARTICIPANT_ANSWER_MAX), answeredAt: z.string().datetime() }).strict();

/** Organizer (task audience) projection. Only the submitted answer is shared; no recipient context, other records or private history. */
export const OrganizerParticipantQuestionSchema = z.object({
  questionId: z.string().uuid(), goalId: z.string().uuid(), goalRevision: z.number().int().positive(), state: ParticipantQuestionStateSchema,
  version: z.number().int().positive(), purpose: z.string(), question: z.string(), recipient: person, askedBy: person,
  expiresAt: z.string().datetime(), publishedAt: z.string().datetime().nullable(), visibility: z.literal("task_organizers"),
  answer: answer.extend({ corrected: z.boolean(), earlierRevisions: z.number().int().min(0) }).strict().nullable(),
  /** Only the person who asked can publish or cancel. */
  canManage: z.boolean(),
}).strict();
export type OrganizerParticipantQuestion = z.infer<typeof OrganizerParticipantQuestionSchema>;

/** Recipient projection: the one question addressed to this person, who asked it, why, until when, who will see the answer, and their own answer. */
export const RecipientParticipantQuestionSchema = z.object({
  questionId: z.string().uuid(), tripId: z.string().uuid(), tripName: z.string(), askedBy: z.string(), purpose: z.string(), question: z.string(),
  expiresAt: z.string().datetime(), state: ParticipantQuestionStateSchema,
  /** The people who will see a submitted answer (the trip's active organizers), named at read time. */
  sharedWith: z.array(z.string()).max(20),
  answer: answer.nullable(), canAnswer: z.boolean(),
}).strict();
export type RecipientParticipantQuestion = z.infer<typeof RecipientParticipantQuestionSchema>;

export const ParticipantAnswerReceiptSchema = z.object({
  questionId: z.string().uuid(), revision: z.number().int().positive(), submissionId: z.string().uuid(), answeredAt: z.string().datetime(), replayed: z.boolean(),
}).strict();
export type ParticipantAnswerReceipt = z.infer<typeof ParticipantAnswerReceiptSchema>;

/**
 * The channel seam (B3): one envelope for correlating an answer with exactly one request in exactly one trip for exactly one recipient. The web
 * adapter derives `recipientPersonId` from authentication; the synthetic adapter from its explicit test mapping. Neither trusts it from a payload.
 */
export type ParticipantAnswerEnvelope = {
  channel: "web" | "synthetic_sms"; tripId: string; recipientPersonId: string;
  /** web: the question id; synthetic_sms: the conversation address. */
  requestRef: string;
  /** web: the submission id; synthetic_sms: the provider message id. */
  deliveryId: string;
  body: string; receivedAt: string;
};
