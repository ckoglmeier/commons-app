import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { createDatabase } from "./client";
import { CommandAccessError, CommandConflictError, commandFingerprint } from "./event-command";
import { isCommonsId } from "./commons-identifier";
import { commons, itineraryItems, memberships, pollDrafts, processedCommands, stays } from "./schema";
import type { PollRepositoryOptions } from "./poll-repository";

const POLL_INFERENCE_HOURLY_LIMIT = 100;

export class PollInferenceLimitError extends Error {
  constructor(message = "This event has used its 100 AI-backed turns for this hour. Keep editing manually or try later.") { super(message); }
}
/** The same command id is already being answered. The provider is never called twice for one command. */
export class PollFramingInFlightError extends Error {
  constructor() { super("Writing help for this request is already in progress. Wait a moment, then ask again."); }
}

/** Reserve provider work under the event lock. No prompt, answer, or shared audit event is recorded. */
export async function reservePollInference(identifier: string, raw: unknown, options: PollRepositoryOptions, purpose: "questions" | "review" = "questions") {
  const input = z.object({ draftId: z.string().uuid(), version: z.number().int().positive() }).strict().parse(raw);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [event] = await tx.select().from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).for("update").limit(1);
      const [member] = event ? await tx.select().from(memberships).where(and(eq(memberships.commonsId, event.id), eq(memberships.personId, options.actorPersonId))) : [];
      if (!event || member?.status !== "active" || member.role !== "organizer") throw new CommandAccessError();
      const [draft] = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.id, input.draftId), eq(pollDrafts.commonsId, event.id), eq(pollDrafts.ownerPersonId, options.actorPersonId)));
      if (!draft) throw new CommandAccessError();
      if (draft.publishedPollId || draft.version !== input.version) throw new CommandConflictError();
      const goal = purpose === "questions" ? z.string().trim().min(5).max(500).parse(draft.data.intro) : "";
      if (purpose === "review" && !draft.data.communication) throw new CommandAccessError();
      const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(processedCommands).where(and(eq(processedCommands.commonsId, event.id), gte(processedCommands.processedAt, new Date(Date.now() - 3600_000)), sql`${processedCommands.result}->>'kind' = 'poll_inference'`));
      if (usage.count >= POLL_INFERENCE_HOURLY_LIMIT) throw new PollInferenceLimitError();
      await tx.insert(processedCommands).values({ commonsId: event.id, commandId: crypto.randomUUID(), result: { kind: "poll_inference", actorPersonId: options.actorPersonId } });
      return { goal, settledFacts: draft.data.settledFacts ?? "" };
    });
  } finally { await database.close(); }
}

const FramingRequest = z.object({ draftId: z.string().uuid(), version: z.number().int().positive(), commandId: z.string().uuid(), change: z.string().trim().max(300).optional() }).strict();

/** Participant-safe facts only. No names, notes, codes, private travel, other drafts, conversations or responses. */
export type PollFramingStoredFacts = {
  trip: { title: string; startsOn: string | null; endsOn: string | null; place: string | null; timezone: string; currency: string; travelerCount: number };
  stays: Array<{ id: string; name: string; startsOn: string; endsOn: string; status: string }>;
  activities: Array<{ id: string; title: string; startsAt: string | null; scheduledDate: string | null; timezone: string; place: string | null; status: string }>;
};

export type PollFramingReservation =
  | { replay: true; result: Record<string, unknown> }
  | { replay: false; request: string; settledFacts: string; change: string | null; draft: { title: string; intro: string | null; questions: import("@commons/contracts").PollWorkingData["questions"] }; facts: PollFramingStoredFacts };

const receiptId = (commandId: string) => `poll_framing:${commandId}`;

/**
 * Reserve one bounded writing-help request under the trip lock. Only an active organizer's own, unpublished draft at the
 * saved version qualifies. The same command id replays the stored sanitized result (or reports in progress); it never reserves twice.
 * `hourlyCap` is the stricter per-trip cap for free trips; the shared pool of 100 per hour always applies.
 */
export async function reservePollFraming(identifier: string, raw: unknown, options: PollRepositoryOptions, policy: { hourlyCap?: number } = {}): Promise<PollFramingReservation> {
  const input = FramingRequest.parse(raw);
  const request = commandFingerprint(options.actorPersonId, "poll.framing", { draftId: input.draftId, version: input.version, change: input.change ?? null });
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [event] = await tx.select().from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).for("update").limit(1);
      const [member] = event ? await tx.select().from(memberships).where(and(eq(memberships.commonsId, event.id), eq(memberships.personId, options.actorPersonId))) : [];
      if (!event || member?.status !== "active" || member.role !== "organizer") throw new CommandAccessError();
      const [prior] = await tx.select().from(processedCommands).where(and(eq(processedCommands.commonsId, event.id), eq(processedCommands.commandId, receiptId(input.commandId))));
      if (prior) {
        if (prior.result.actorPersonId !== options.actorPersonId) throw new CommandAccessError();
        if (prior.result.request !== request) throw new CommandConflictError();
        if (prior.result.phase === "completed" && prior.result.outcome) return { replay: true as const, result: prior.result.outcome as Record<string, unknown> };
        throw new PollFramingInFlightError();
      }
      const [draft] = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.id, input.draftId), eq(pollDrafts.commonsId, event.id), eq(pollDrafts.ownerPersonId, options.actorPersonId)));
      if (!draft) throw new CommandAccessError();
      if (draft.publishedPollId || draft.archivedAt || draft.version !== input.version) throw new CommandConflictError();
      // A private request wins; drafts saved before it existed used the shared introduction as the goal.
      const text = z.string().trim().min(5).max(500).parse(draft.data.framingRequest?.trim() ? draft.data.framingRequest : draft.data.intro);
      const since = new Date(Date.now() - 3600_000);
      const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(processedCommands).where(and(eq(processedCommands.commonsId, event.id), gte(processedCommands.processedAt, since), sql`${processedCommands.result}->>'kind' = 'poll_inference'`));
      if (policy.hourlyCap !== undefined && usage.count >= policy.hourlyCap) throw new PollInferenceLimitError(`This trip has used its ${policy.hourlyCap} writing-help requests for this hour. Keep editing, or ask again later.`);
      if (usage.count >= POLL_INFERENCE_HOURLY_LIMIT) throw new PollInferenceLimitError();
      await tx.insert(processedCommands).values({ commonsId: event.id, commandId: receiptId(input.commandId), result: { kind: "poll_inference", actorPersonId: options.actorPersonId, phase: "reserved", request } });
      const optionIds = [...new Set(draft.data.questions.flatMap(question => question.kind === "choice" ? question.options.flatMap(option => [option.id, ...(option.resource?.type === "stay" ? [option.resource.id] : [])]) : []))];
      const [travelers] = await tx.select({ count: sql<number>`count(*)::int` }).from(memberships).where(and(eq(memberships.commonsId, event.id), eq(memberships.status, "active"), sql`${memberships.attendanceState} <> 'declined'`));
      const stayRows = optionIds.length ? await tx.select({ id: stays.id, name: stays.name, startsOn: stays.startsOn, endsOn: stays.endsOn, status: stays.status }).from(stays).where(and(eq(stays.commonsId, event.id), inArray(stays.id, optionIds))) : [];
      const activityRows = optionIds.length ? await tx.select({ id: itineraryItems.id, title: itineraryItems.title, startsAt: itineraryItems.startsAt, scheduledDate: itineraryItems.scheduledDate, timezone: itineraryItems.timezone, place: itineraryItems.locationName, status: itineraryItems.status })
        .from(itineraryItems).where(and(eq(itineraryItems.commonsId, event.id), inArray(itineraryItems.id, optionIds), eq(itineraryItems.audience, "everyone"), sql`${itineraryItems.status} <> 'cancelled'`)) : [];
      return { replay: false as const, request: text, settledFacts: draft.data.settledFacts ?? "", change: input.change?.trim() || null,
        draft: { title: draft.data.title, intro: draft.data.intro, questions: draft.data.questions },
        facts: { trip: { title: event.name, startsOn: event.startsOn, endsOn: event.endsOn, place: event.locationName, timezone: event.timezone, currency: event.currency, travelerCount: travelers.count },
          stays: stayRows, activities: activityRows.map(row => ({ ...row, startsAt: row.startsAt?.toISOString() ?? null })) } };
    });
  } finally { await database.close(); }
}

/** Stores the sanitized result with the reservation so a retry of the same command returns it without another provider call. */
export async function completePollFraming(identifier: string, raw: { commandId: string }, outcome: Record<string, unknown> | null, options: PollRepositoryOptions) {
  const commandId = z.string().uuid().parse(raw.commandId);
  const database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(async tx => {
      const [event] = await tx.select({ id: commons.id }).from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).limit(1);
      if (!event) return;
      const [prior] = await tx.select().from(processedCommands).where(and(eq(processedCommands.commonsId, event.id), eq(processedCommands.commandId, receiptId(commandId)))).for("update");
      if (!prior || prior.result.actorPersonId !== options.actorPersonId || prior.result.phase !== "reserved") return;
      await tx.update(processedCommands).set({ result: { ...prior.result, phase: outcome ? "completed" : "failed", ...(outcome ? { outcome } : {}) } }).where(eq(processedCommands.id, prior.id));
    });
  } finally { await database.close(); }
}
