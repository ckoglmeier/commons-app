import { formatTripDateRange } from "@commons/contracts";
import { and, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { createDatabase } from "./client";
import { CommandAccessError, type CommandTransaction } from "./event-command";
import { isCommonsId } from "./commons-identifier";
import { auditEvents, commons, memberships, pollResponses, polls } from "./schema";

/*
 * Two stages of one trip (DESIGN.md §9 (Trip)). A new trip starts out getting to a decision and moves
 * to "We're going" only when its organizer says so. Poll answers never decide anything here: only `decideBigQuestion` does, and only an organizer can call it.
 */

export type TripStage = "deciding" | "going";
export const BIG_QUESTION_IDS = ["where", "when", "who"] as const;
export type BigQuestionId = (typeof BIG_QUESTION_IDS)[number];

/**
 * Every trip now uses the two stages, and new trips are created with `new_experience` true. The column is still read for
 * one purpose: trips created before the stages existed have it false, and they must keep reading as "going".
 */
export function tripStage(trip: { newExperience: boolean; goingAt: Date | null }): TripStage {
  return trip.newExperience && !trip.goingAt ? "deciding" : "going";
}

type Options = { databaseUrl?: string; actorPersonId: string };

async function organizerTrip(tx: Pick<CommandTransaction, "select">, identifier: string, actorPersonId: string, lock = false) {
  const query = tx.select({ id: commons.id, name: commons.name, locationName: commons.locationName, startsOn: commons.startsOn, endsOn: commons.endsOn, newExperience: commons.newExperience, goingAt: commons.goingAt, bigQuestions: commons.bigQuestions, welcomeMessage: commons.welcomeMessage, role: memberships.role, status: memberships.status })
    .from(commons).innerJoin(memberships, and(eq(memberships.commonsId, commons.id), eq(memberships.personId, actorPersonId)))
    .where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier));
  const [trip] = await (lock ? query.for("update", { of: commons }) : query);
  if (!trip || trip.role !== "organizer" || trip.status !== "active") throw new CommandAccessError();
  return trip;
}

export type BigQuestionView = {
  id: BigQuestionId;
  decided: string | null;
  /** What is saved, so "Change" opens with it. Present only when the question has an answer. */
  saved?: { locationName: string } | { startsOn: string; endsOn: string } | { note: string };
  poll: { id: string; publicId: string; title: string; open: boolean; answers: number } | null;
};

/** Organizer-only. Answers stay on the poll page; this is only how many there are. */
export async function readBigQuestions(identifier: string, options: Options) {
  const database = createDatabase(options.databaseUrl);
  try {
    const trip = await organizerTrip(database.db, identifier, options.actorPersonId);
    const saved = trip.bigQuestions ?? {};
    const pollIds = BIG_QUESTION_IDS.flatMap(id => saved[id]?.pollId ? [saved[id]!.pollId!] : []);
    const rows = pollIds.length ? await database.db.select({ id: polls.id, publicId: polls.publicId, title: polls.title, status: polls.status }).from(polls).where(and(eq(polls.commonsId, trip.id), inArray(polls.id, pollIds))) : [];
    const answers = pollIds.length ? await database.db.select({ pollId: pollResponses.pollId, total: count() }).from(pollResponses).where(inArray(pollResponses.pollId, pollIds)).groupBy(pollResponses.pollId) : [];
    const dates = trip.startsOn && trip.endsOn ? formatTripDateRange(trip.startsOn, trip.endsOn) : null;
    const decidedFor: Record<BigQuestionId, string | null> = { where: trip.locationName, when: dates, who: saved.who?.note ?? null };
    const savedFor: Record<BigQuestionId, BigQuestionView["saved"]> = { where: trip.locationName ? { locationName: trip.locationName } : undefined, when: trip.startsOn && trip.endsOn ? { startsOn: trip.startsOn, endsOn: trip.endsOn } : undefined, who: saved.who?.note ? { note: saved.who.note } : undefined };
    const questions: BigQuestionView[] = BIG_QUESTION_IDS.map(id => {
      const poll = rows.find(row => row.id === saved[id]?.pollId);
      return { id, decided: decidedFor[id], ...(savedFor[id] ? { saved: savedFor[id] } : {}), poll: poll ? { id: poll.id, publicId: poll.publicId, title: poll.title, open: poll.status === "open", answers: Number(answers.find(row => row.pollId === poll.id)?.total ?? 0) } : null };
    });
    return { stage: tripStage(trip), questions, welcome: trip.welcomeMessage, decideBy: saved.decideBy ?? null, roughCost: saved.roughCost ?? null };
  } finally { await database.close(); }
}

const AttachSchema = z.object({ question: z.enum(BIG_QUESTION_IDS), pollId: z.string().uuid() }).strict();

/** Which poll is asking a question. The newest poll wins, and earlier answers stay on their own poll. */
export async function attachBigQuestionPoll(identifier: string, raw: unknown, options: Options) {
  const input = AttachSchema.parse(raw), database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(async tx => {
      const trip = await organizerTrip(tx, identifier, options.actorPersonId, true);
      const [poll] = await tx.select({ id: polls.id }).from(polls).where(and(eq(polls.id, input.pollId), eq(polls.commonsId, trip.id)));
      if (!poll) throw new CommandAccessError();
      const saved = trip.bigQuestions ?? {};
      await tx.update(commons).set({ bigQuestions: { ...saved, [input.question]: { ...saved[input.question], pollId: input.pollId } }, updatedAt: new Date() }).where(eq(commons.id, trip.id));
    });
  } finally { await database.close(); }
}

const DecideSchema = z.discriminatedUnion("question", [
  z.object({ commandId: z.string().uuid(), question: z.literal("where"), locationName: z.string().trim().min(1).max(120) }).strict(),
  z.object({ commandId: z.string().uuid(), question: z.literal("when"), startsOn: z.string().date(), endsOn: z.string().date() }).strict().refine(value => value.endsOn >= value.startsOn, "The last day comes after the first."),
  z.object({ commandId: z.string().uuid(), question: z.literal("who"), note: z.string().trim().min(1).max(500) }).strict(),
]);

/** The organizer's decision. "Who's in" is a note in their words: it isn't attendance or membership, and it invites nobody. */
export async function decideBigQuestion(identifier: string, raw: unknown, options: Options) {
  const input = DecideSchema.parse(raw), database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(async tx => {
      const trip = await organizerTrip(tx, identifier, options.actorPersonId, true);
      const now = new Date(), saved = trip.bigQuestions ?? {};
      await tx.update(commons).set({
        ...(input.question === "where" ? { locationName: input.locationName } : input.question === "when" ? { startsOn: input.startsOn, endsOn: input.endsOn } : {}),
        bigQuestions: { ...saved, [input.question]: { ...saved[input.question], decidedAt: now.toISOString(), ...(input.question === "who" ? { note: input.note } : {}) } },
        updatedAt: now,
      }).where(eq(commons.id, trip.id));
      await tx.insert(auditEvents).values({ commonsId: trip.id, commandId: input.commandId, actorId: options.actorPersonId, actorType: "human", action: "trip.big_question_decided", resourceType: "commons", resourceId: trip.id, summary: `Decided ${input.question === "where" ? "where" : input.question === "when" ? "when" : "who’s in"} for this trip.` }).onConflictDoNothing();
    });
  } finally { await database.close(); }
}

const BriefSchema = z.object({ decideBy: z.string().date().nullable(), roughCost: z.string().trim().max(80).nullable() }).strict();

/** The deadline and rough cost shown on this trip's polls. An organizer's estimate: it changes nothing in Money. */
export async function saveTripBrief(identifier: string, raw: unknown, options: Options) {
  const input = BriefSchema.parse(raw), database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(async tx => {
      const trip = await organizerTrip(tx, identifier, options.actorPersonId, true);
      const { decideBy: _decideBy, roughCost: _roughCost, ...rest } = trip.bigQuestions ?? {};
      void _decideBy; void _roughCost;
      await tx.update(commons).set({ bigQuestions: { ...rest, ...(input.decideBy ? { decideBy: input.decideBy } : {}), ...(input.roughCost ? { roughCost: input.roughCost } : {}) }, updatedAt: new Date() }).where(eq(commons.id, trip.id));
    });
  } finally { await database.close(); }
}

/** "We're going." An explicit organizer action. Repeating it changes nothing. */
export async function markTripGoing(identifier: string, options: Options) {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const trip = await organizerTrip(tx, identifier, options.actorPersonId, true);
      if (tripStage(trip) === "going") return { stage: "going" as const };
      const now = new Date();
      await tx.update(commons).set({ goingAt: now, updatedAt: now }).where(eq(commons.id, trip.id));
      await tx.insert(auditEvents).values({ commonsId: trip.id, commandId: `trip-going:${trip.id}`, actorId: options.actorPersonId, actorType: "human", action: "trip.going", resourceType: "commons", resourceId: trip.id, summary: `Said ${trip.name} is going ahead.` }).onConflictDoNothing();
      return { stage: "going" as const };
    });
  } finally { await database.close(); }
}
