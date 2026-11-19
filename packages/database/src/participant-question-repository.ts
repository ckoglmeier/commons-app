import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  AnswerParticipantQuestionSchema, CancelParticipantQuestionSchema, isGoalTerminal, PrepareParticipantQuestionSchema, PublishParticipantQuestionSchema,
  type OrganizerParticipantQuestion, type ParticipantAnswerReceipt, type ParticipantQuestionState, type RecipientParticipantQuestion,
} from "@commons/contracts";
import { z } from "zod";
import { createDatabase } from "./client";
import { isCommonsId } from "./commons-identifier";
import { CommandAccessError, CommandConflictError, commandFingerprint, type CommandTransaction } from "./event-command";
import { requireTripOrganizer } from "./coordinator-turn-repository";
import { commons, coordinatorGoalReports, coordinatorGoals, coordinatorTurns, memberships, participantAnswers, participantQuestions, people } from "./schema";

/*
 * Conversation durability lane B: one organizer-reviewed web question to one traveler (schema comment in schema.ts says why this is not outreach or a
 * poll). Authority, in one place:
 * - Prepare, publish and cancel: the task's starter, while an active organizer, for an open goal at its current revision. The recipient is another
 *   active member of the same trip. Preparing and previewing deliver nothing; publishing makes the exact saved version available on the web.
 * - Read the answer: active organizers of the trip (the task's audience), through the organizer projection only.
 * - Read the question and answer it: only the addressed active member. Everyone else, including other organizers on the recipient route, gets
 *   not-found: no question text, purpose or existence is disclosed. A deep link carries an id, never authority.
 * - An answer is bound to the published question, its goal revision and the expected answer revision. The same submission replays its receipt; the same
 *   submission with a different body is a conflict; a stale tab cannot overwrite a correction. The answer and its task report commit together.
 * Nothing here changes travel, Plan, attendance or goal completion. A collected answer is reported evidence, not a finish line.
 */

type Options = { databaseUrl?: string; actorPersonId: string; now?: Date };
type Question = typeof participantQuestions.$inferSelect;

async function tripIdOf(tx: CommandTransaction, identifier: string, lock = false) {
  const query = tx.select({ id: commons.id, name: commons.name }).from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).limit(1);
  const [event] = lock ? await query.for("update") : await query;
  if (!event) throw new CommandAccessError();
  return event;
}
async function activeMember(tx: CommandTransaction, tripId: string, personId: string) {
  const [member] = await tx.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.commonsId, tripId), eq(memberships.personId, personId), eq(memberships.status, "active"))).limit(1);
  return member ?? null;
}
async function nameOf(tx: CommandTransaction, personId: string) {
  const [row] = await tx.select({ name: people.displayName }).from(people).where(eq(people.id, personId)).limit(1);
  return (row?.name ?? "A traveler").slice(0, 160);
}
async function organizerNames(tx: CommandTransaction, tripId: string) {
  const rows = await tx.select({ name: people.displayName }).from(memberships).innerJoin(people, eq(people.id, memberships.personId))
    .where(and(eq(memberships.commonsId, tripId), eq(memberships.status, "active"), eq(memberships.role, "organizer"))).orderBy(asc(people.displayName)).limit(20);
  return rows.map(row => row.name.slice(0, 160));
}

export function participantQuestionState(question: Pick<Question, "status" | "expiresAt" | "answerRevision">, now: Date): ParticipantQuestionState {
  if (question.status === "draft") return "draft";
  if (question.status === "cancelled") return "cancelled";
  if (question.status === "closed") return "closed";
  if (question.answerRevision > 0) return question.expiresAt <= now ? "closed" : "answered";
  return question.expiresAt <= now ? "expired" : "waiting";
}

async function lockGoal(tx: CommandTransaction, tripId: string, goalId: string) {
  const [goal] = await tx.select().from(coordinatorGoals).where(and(eq(coordinatorGoals.id, goalId), eq(coordinatorGoals.commonsId, tripId))).for("update");
  if (!goal) throw new CommandAccessError();
  return goal;
}

/** Prepare a private draft. Idempotent on the command id: the same command replays the same draft; a different payload is a conflict. */
export async function prepareParticipantQuestion(identifier: string, raw: unknown, options: Options) {
  const input = PrepareParticipantQuestionSchema.parse(raw), now = options.now ?? new Date();
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const tripId = await requireTripOrganizer(tx, identifier, options.actorPersonId);
      const [existing] = await tx.select().from(participantQuestions).where(and(eq(participantQuestions.commonsId, tripId), eq(participantQuestions.createdByPersonId, options.actorPersonId), eq(participantQuestions.createCommandId, input.commandId))).limit(1);
      if (existing) {
        if (existing.goalId !== input.goalId || existing.recipientPersonId !== input.recipientPersonId || existing.question !== input.question || existing.purpose !== input.purpose) throw new CommandConflictError();
        return { questionId: existing.id, version: existing.version, replayed: true };
      }
      const goal = await lockGoal(tx, tripId, input.goalId);
      if (goal.createdByPersonId !== options.actorPersonId) throw new CommandAccessError();
      if (isGoalTerminal(goal.lifecycle) || goal.revision !== input.expectedGoalRevision) throw new CommandConflictError();
      if (input.recipientPersonId === options.actorPersonId || !await activeMember(tx, tripId, input.recipientPersonId)) throw new CommandAccessError();
      const [row] = await tx.insert(participantQuestions).values({ commonsId: tripId, goalId: goal.id, goalRevision: goal.revision, createdByPersonId: options.actorPersonId,
        recipientPersonId: input.recipientPersonId, purpose: input.purpose, question: input.question, expiresAt: new Date(now.getTime() + input.expiresInHours * 3_600_000),
        createCommandId: input.commandId, createdAt: now, updatedAt: now }).returning();
      return { questionId: row.id, version: row.version, replayed: false };
    });
  } finally { await database.close(); }
}

/** Explicit publication of the exact saved version. Delivers nothing; it makes the question available to its recipient on the web. */
export async function publishParticipantQuestion(identifier: string, raw: unknown, options: Options) {
  const input = PublishParticipantQuestionSchema.parse(raw), now = options.now ?? new Date();
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const tripId = await requireTripOrganizer(tx, identifier, options.actorPersonId);
      const [question] = await tx.select().from(participantQuestions).where(and(eq(participantQuestions.id, input.questionId), eq(participantQuestions.commonsId, tripId))).for("update");
      if (!question || question.createdByPersonId !== options.actorPersonId) throw new CommandAccessError();
      if (question.status === "published" && question.publishCommandId === input.commandId) return { questionId: question.id, version: question.version, replayed: true };
      if (question.status !== "draft" || question.version !== input.expectedVersion || question.expiresAt <= now) throw new CommandConflictError();
      const goal = await lockGoal(tx, tripId, question.goalId);
      if (isGoalTerminal(goal.lifecycle) || goal.revision !== question.goalRevision) throw new CommandConflictError();
      if (!await activeMember(tx, tripId, question.recipientPersonId)) throw new CommandAccessError();
      await tx.update(participantQuestions).set({ status: "published", publishedAt: now, publishCommandId: input.commandId, updatedAt: now }).where(eq(participantQuestions.id, question.id));
      return { questionId: question.id, version: question.version, replayed: false };
    });
  } finally { await database.close(); }
}

/**
 * The asker discards a draft or withdraws an open question. A draft was never available to anyone, so discarding deletes it (its command id is then
 * free for a new draft). A withdrawn question keeps its answers as history, visible to the task's organizers.
 */
export async function cancelParticipantQuestion(identifier: string, raw: unknown, options: Options) {
  const input = CancelParticipantQuestionSchema.parse(raw), now = options.now ?? new Date();
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const tripId = await requireTripOrganizer(tx, identifier, options.actorPersonId);
      const [question] = await tx.select().from(participantQuestions).where(and(eq(participantQuestions.id, input.questionId), eq(participantQuestions.commonsId, tripId))).for("update");
      if (!question || question.createdByPersonId !== options.actorPersonId) throw new CommandAccessError();
      if (question.status === "cancelled") return { questionId: question.id, replayed: true };
      if (question.status === "closed") throw new CommandConflictError();
      if (question.status === "draft") { await tx.delete(participantQuestions).where(eq(participantQuestions.id, question.id)); return { questionId: question.id, replayed: false, discarded: true }; }
      await tx.update(participantQuestions).set({ status: "cancelled", closedAt: now, updatedAt: now }).where(eq(participantQuestions.id, question.id));
      return { questionId: question.id, replayed: false };
    });
  } finally { await database.close(); }
}

async function organizerView(tx: CommandTransaction, question: Question, actorPersonId: string, now: Date): Promise<OrganizerParticipantQuestion> {
  const answers = question.answerRevision > 0 ? await tx.select().from(participantAnswers).where(eq(participantAnswers.questionId, question.id)).orderBy(desc(participantAnswers.revision)) : [];
  const current = answers[0];
  return {
    questionId: question.id, goalId: question.goalId, goalRevision: question.goalRevision, state: participantQuestionState(question, now), version: question.version,
    purpose: question.purpose, question: question.question,
    recipient: { personId: question.recipientPersonId, name: await nameOf(tx, question.recipientPersonId) },
    askedBy: { personId: question.createdByPersonId, name: await nameOf(tx, question.createdByPersonId) },
    expiresAt: question.expiresAt.toISOString(), publishedAt: question.publishedAt?.toISOString() ?? null, visibility: "task_organizers",
    answer: current ? { revision: current.revision, body: current.body, answeredAt: current.createdAt.toISOString(), corrected: current.revision > 1, earlierRevisions: answers.length - 1 } : null,
    canManage: question.createdByPersonId === actorPersonId && (question.status === "draft" || question.status === "published"),
  };
}

/** The task audience's projection: every question on this goal, with only the submitted answers. Active organizers only. */
export async function listGoalParticipantQuestions(identifier: string, goalId: string, options: Options) {
  z.string().uuid().parse(goalId);
  const now = options.now ?? new Date();
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const tripId = await requireTripOrganizer(tx, identifier, options.actorPersonId, false);
      const rows = await tx.select().from(participantQuestions).where(and(eq(participantQuestions.commonsId, tripId), eq(participantQuestions.goalId, goalId))).orderBy(desc(participantQuestions.createdAt)).limit(20);
      return Promise.all(rows.filter(row => row.status !== "draft" || row.createdByPersonId === options.actorPersonId).map(row => organizerView(tx, row, options.actorPersonId, now)));
    });
  } finally { await database.close(); }
}

async function recipientView(tx: CommandTransaction, question: Question, tripName: string, now: Date): Promise<RecipientParticipantQuestion> {
  const [current] = question.answerRevision > 0 ? await tx.select().from(participantAnswers).where(and(eq(participantAnswers.questionId, question.id), eq(participantAnswers.revision, question.answerRevision))).limit(1) : [];
  const state = participantQuestionState(question, now);
  const [goal] = await tx.select({ lifecycle: coordinatorGoals.lifecycle, revision: coordinatorGoals.revision }).from(coordinatorGoals).where(eq(coordinatorGoals.id, question.goalId)).limit(1);
  const open = (state === "waiting" || state === "answered") && Boolean(goal) && !isGoalTerminal(goal.lifecycle) && goal.revision === question.goalRevision;
  return {
    questionId: question.id, tripId: question.commonsId, tripName: tripName.slice(0, 200), askedBy: await nameOf(tx, question.createdByPersonId),
    purpose: question.purpose, question: question.question, expiresAt: question.expiresAt.toISOString(), state: open ? state : state === "waiting" || state === "answered" ? "closed" : state,
    sharedWith: await organizerNames(tx, question.commonsId),
    answer: current ? { revision: current.revision, body: current.body, answeredAt: current.createdAt.toISOString() } : null,
    canAnswer: open,
  };
}

/** The recipient's own questions on this trip: published ones and their closed/cancelled disposition. Never drafts, never anyone else's. */
export async function listRecipientParticipantQuestions(identifier: string, options: Options) {
  const now = options.now ?? new Date();
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const trip = await tripIdOf(tx, identifier);
      if (!await activeMember(tx, trip.id, options.actorPersonId)) throw new CommandAccessError();
      // Home asks on every load: before migration 0103 is applied there is simply nothing to list.
      const [present] = await tx.execute<{ present: boolean }>(sql`select to_regclass('public.participant_questions') is not null as present`);
      if (!present?.present) return [];
      const rows = await tx.select().from(participantQuestions).where(and(eq(participantQuestions.commonsId, trip.id), eq(participantQuestions.recipientPersonId, options.actorPersonId), inArray(participantQuestions.status, ["published", "closed", "cancelled"])))
        .orderBy(desc(participantQuestions.publishedAt)).limit(10);
      return Promise.all(rows.map(row => recipientView(tx, row, trip.name, now)));
    });
  } finally { await database.close(); }
}

/** One question for its recipient. Anyone else, or another trip's id, is not found. */
export async function readRecipientParticipantQuestion(identifier: string, questionId: string, options: Options) {
  if (!z.string().uuid().safeParse(questionId).success) throw new CommandAccessError();
  const now = options.now ?? new Date();
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const trip = await tripIdOf(tx, identifier);
      const [question] = await tx.select().from(participantQuestions).where(and(eq(participantQuestions.id, questionId), eq(participantQuestions.commonsId, trip.id), eq(participantQuestions.recipientPersonId, options.actorPersonId))).limit(1);
      if (!question || question.status === "draft" || !await activeMember(tx, trip.id, options.actorPersonId)) throw new CommandAccessError();
      return recipientView(tx, question, trip.name, now);
    });
  } finally { await database.close(); }
}

/**
 * The single authorized answer command (web adapter). Inside one transaction under the question row lock: replay first (an accepted submission keeps
 * its receipt even after the question closes), then current authority and state, then the answer revision and the task report together.
 */
export async function answerParticipantQuestion(identifier: string, questionId: string, raw: unknown, options: Options): Promise<ParticipantAnswerReceipt> {
  if (!z.string().uuid().safeParse(questionId).success) throw new CommandAccessError();
  const input = AnswerParticipantQuestionSchema.parse(raw), now = options.now ?? new Date();
  const fingerprint = commandFingerprint(options.actorPersonId, "participant_question.answer", { questionId, body: input.body, expectedAnswerRevision: input.expectedAnswerRevision });
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      // Match publication/withdrawal and trip approval: trip, then question, then goal.
      const trip = await tripIdOf(tx, identifier, true);
      const [question] = await tx.select().from(participantQuestions).where(and(eq(participantQuestions.id, questionId), eq(participantQuestions.commonsId, trip.id), eq(participantQuestions.recipientPersonId, options.actorPersonId))).for("update");
      if (!question || question.status === "draft") throw new CommandAccessError();
      const [prior] = await tx.select().from(participantAnswers).where(and(eq(participantAnswers.questionId, question.id), eq(participantAnswers.submissionId, input.submissionId))).limit(1);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new CommandConflictError();
        return { questionId: question.id, revision: prior.revision, submissionId: prior.submissionId, answeredAt: prior.createdAt.toISOString(), replayed: true };
      }
      if (!await activeMember(tx, trip.id, options.actorPersonId)) throw new CommandAccessError();
      const goal = await lockGoal(tx, trip.id, question.goalId);
      const asker = await activeMember(tx, trip.id, question.createdByPersonId);
      // Closed, cancelled, expired, a finished or revised task, or an asker who is no longer an organizer: a fresh submission is refused, not queued.
      if (question.status !== "published" || question.expiresAt <= now || isGoalTerminal(goal.lifecycle) || goal.revision !== question.goalRevision || asker?.role !== "organizer") throw new ParticipantQuestionClosedError();
      if (input.expectedAnswerRevision !== question.answerRevision) throw new CommandConflictError();
      const revision = question.answerRevision + 1, recipientName = await nameOf(tx, options.actorPersonId);
      await tx.insert(participantAnswers).values({ questionId: question.id, commonsId: trip.id, revision, answeredByPersonId: options.actorPersonId, submissionId: input.submissionId, fingerprint, body: input.body, createdAt: now });
      await tx.update(participantQuestions).set({ answerRevision: revision, updatedAt: now }).where(eq(participantQuestions.id, question.id));
      // One report per answer revision, to the task's organizers. A correction supersedes the earlier report; both stay as history.
      if (revision > 1) await tx.update(coordinatorGoalReports).set({ supersededAt: now }).where(and(eq(coordinatorGoalReports.goalId, goal.id), sql`${coordinatorGoalReports.discriminator} like ${`participant_answer:${question.id}:%`}`, sql`${coordinatorGoalReports.supersededAt} is null`));
      await tx.insert(coordinatorGoalReports).values({ commonsId: trip.id, goalId: goal.id, mainThreadId: goal.mainThreadId, goalRevision: goal.revision, kind: "milestone",
        discriminator: `participant_answer:${question.id}:${revision}`,
        headline: `${goal.title}: ${recipientName} ${revision > 1 ? "corrected their answer" : "answered your question"}.`.slice(0, 240),
        detail: `Answer to “${question.question.slice(0, 120)}”, shared with this task's organizers. It is reported evidence, not a saved travel detail, a Plan change or the end of this task.`,
        nextAction: "Open task", sources: [], createdAt: now }).onConflictDoNothing();
      return { questionId: question.id, revision, submissionId: input.submissionId, answeredAt: now.toISOString(), replayed: false };
    });
  } finally { await database.close(); }
}

export class ParticipantQuestionClosedError extends CommandConflictError { readonly closed = true; }

/**
 * B05: a pending proposal prepared in a task's conversation before one of that task's answers was corrected may rest on the earlier answer. Applying
 * it is refused; the organizer reviews again with the current answer. A first answer arriving later cannot have been used, so it does not invalidate.
 */
export async function assertParticipantEvidenceCurrent(tx: CommandTransaction, tripId: string, turnId: string) {
  const [present] = await tx.execute<{ present: boolean }>(sql`select to_regclass('public.participant_answers') is not null as present`);
  if (!present?.present) return;
  const [turn] = await tx.select({ threadId: coordinatorTurns.threadId, createdAt: coordinatorTurns.createdAt }).from(coordinatorTurns).where(and(eq(coordinatorTurns.id, turnId), eq(coordinatorTurns.commonsId, tripId))).limit(1);
  if (!turn?.threadId) return;
  const [corrected] = await tx.select({ id: participantAnswers.id }).from(participantAnswers)
    .innerJoin(participantQuestions, eq(participantQuestions.id, participantAnswers.questionId))
    .innerJoin(coordinatorGoals, eq(coordinatorGoals.id, participantQuestions.goalId))
    .where(and(eq(participantAnswers.commonsId, tripId), eq(coordinatorGoals.threadId, turn.threadId), gt(participantAnswers.revision, 1), gt(participantAnswers.createdAt, turn.createdAt))).limit(1);
  if (corrected) throw new CommandConflictError();
}

/** Goal-conversation context: the task's current answers as attributed, reported evidence (never trip facts), for active organizers only. */
export async function goalParticipantEvidence(tx: CommandTransaction, tripId: string, goalId: string) {
  const rows = await tx.select().from(participantQuestions).where(and(eq(participantQuestions.commonsId, tripId), eq(participantQuestions.goalId, goalId), gt(participantQuestions.answerRevision, 0))).limit(10);
  const evidence = [];
  for (const row of rows) {
    const [current] = await tx.select().from(participantAnswers).where(and(eq(participantAnswers.questionId, row.id), eq(participantAnswers.revision, row.answerRevision))).limit(1);
    if (current) evidence.push({ question: row.question, answeredBy: await nameOf(tx, row.recipientPersonId), answer: current.body, revision: current.revision, answeredAt: current.createdAt.toISOString(), kind: "reported by the traveler; not verified, not saved as a travel detail" });
  }
  return evidence;
}

/** Standalone read of `goalParticipantEvidence` for the organizer conversation context. Active organizers only. */
export async function readGoalParticipantEvidence(identifier: string, goalId: string, options: Options) {
  z.string().uuid().parse(goalId);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const tripId = await requireTripOrganizer(tx, identifier, options.actorPersonId, false);
      const [present] = await tx.execute<{ present: boolean }>(sql`select to_regclass('public.participant_questions') is not null as present`);
      return present?.present ? goalParticipantEvidence(tx, tripId, goalId) : [];
    });
  } finally { await database.close(); }
}

/** People the asker may address: other active members of this trip. Names only; no contact details. Active organizers only. */
export async function listParticipantQuestionRecipients(identifier: string, options: Options) {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const tripId = await requireTripOrganizer(tx, identifier, options.actorPersonId, false);
      const rows = await tx.select({ personId: memberships.personId, name: people.displayName, role: memberships.role }).from(memberships).innerJoin(people, eq(people.id, memberships.personId))
        .where(and(eq(memberships.commonsId, tripId), eq(memberships.status, "active"))).orderBy(asc(people.displayName)).limit(100);
      return rows.filter(row => row.personId !== options.actorPersonId).map(row => ({ personId: row.personId, name: row.name.slice(0, 160), organizer: row.role === "organizer" }));
    });
  } finally { await database.close(); }
}
