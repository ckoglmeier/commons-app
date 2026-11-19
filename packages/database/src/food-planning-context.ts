import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { summarizeFoodResponses, type TripContextSnapshot } from "@commons/contracts";
import type { CommandTransaction } from "./event-command";
import { pollDrafts, pollResponses, polls, recipeRuns } from "./schema";

/** Call only after fresh organizer authorization. Derive from saved answers: no copied outcome, approval, or Plan mutation. */
export async function readFoodPlanningContext(tx: CommandTransaction, tripId: string, asOf: string, runId?: string): Promise<TripContextSnapshot["foodPreferences"]> {
  const drafts = await tx.selectDistinctOn([pollDrafts.runId], { runId: pollDrafts.runId, pollId: pollDrafts.publishedPollId, archivedAt: pollDrafts.archivedAt })
    .from(pollDrafts).innerJoin(recipeRuns, eq(recipeRuns.id, pollDrafts.runId))
    .where(and(eq(recipeRuns.commonsId, tripId), eq(pollDrafts.commonsId, tripId), eq(recipeRuns.recipe, "food_preferences"), eq(recipeRuns.status, "active"), runId ? eq(recipeRuns.id, runId) : undefined))
    .orderBy(asc(pollDrafts.runId), desc(pollDrafts.createdAt), desc(pollDrafts.id)).limit(21);
  const ids = drafts.filter(d => !d.archivedAt).slice(0, 20).map(d => d.runId!);
  if (!ids.length) return [];
  // Revisions never erase reported allergies. Keep bounded, labelled historical
  // input even during a partial new round, without carrying any votes forward.
  const sources = await tx.select({ poll: polls, runId: pollDrafts.runId }).from(pollDrafts).innerJoin(polls, eq(polls.id, pollDrafts.publishedPollId))
    .where(and(inArray(pollDrafts.runId, ids), eq(pollDrafts.commonsId, tripId), eq(polls.commonsId, tripId), inArray(polls.status, ["open", "closed"]), sql`${polls.archivedAt} is null`))
    .orderBy(sql`exists (select 1 from ${pollResponses} where ${pollResponses.pollId} = ${polls.id}) desc`, desc(pollDrafts.createdAt), desc(pollDrafts.id)).limit(21);
  const result: TripContextSnapshot["foodPreferences"] = [];
  for (const source of sources.slice(0, 20)) {
    const { poll } = source, latest = drafts.find(d => d.runId === source.runId)!;
    const earlier = latest.pollId !== poll.id, historyIncomplete = sources.length > 20 || drafts.length > 20;
    // Defense in depth: only the explicitly organizer-only written questions enter this projection.
    const questions = poll.questions.filter(q => q.kind === "text" && q.organizerOnly === true);
    if (!questions.length) continue;
    const rows = await tx.select({ id: pollResponses.id, name: pollResponses.respondentName, answers: pollResponses.answers, updatedAt: pollResponses.updatedAt })
      .from(pollResponses).where(eq(pollResponses.pollId, poll.id)).orderBy(asc(pollResponses.id));
    const summary = summarizeFoodResponses(questions, rows);
    const cap = (s: string | null, max: number) => s && s.length > max ? `${s.slice(0, max - 1)}…` : s;
    result.push({ id: `food:${poll.id}`, version: createHash("sha256").update(JSON.stringify([poll.updatedAt, rows, earlier, latest.pollId, historyIncomplete])).digest("hex"),
      provenance: { kind: "poll_preference", recordType: "poll", recordId: poll.id, threadId: poll.threadId, label: earlier ? "Earlier-round reported food preferences — not reconfirmed" : "Reported food preferences" },
      freshness: { asOf, updatedAt: new Date(Math.max(poll.updatedAt.getTime(), ...rows.map(r => r.updatedAt.getTime()))).toISOString() },
      value: { runId: source.runId!, pollId: poll.id, title: poll.title.slice(0, 120), status: poll.status as "open" | "closed",
        roundState: earlier ? "earlier" : "current", replacementState: earlier ? latest.pollId ? "published_round" : "private_draft" : null, historyIncomplete,
        responseCount: rows.length, omittedResponses: Math.max(0, rows.length - 60), entries: summary.entries.slice(0, 60).map(e => ({ ...e,
          name: cap(e.name, 160)!, requirements: cap(e.requirements, 1000), preferences: cap(e.preferences, 1000), notes: cap(e.notes, 1000),
          truncated: [e.requirements, e.preferences, e.notes].some(s => s && s.length > 1000) })) } });
  }
  return result;
}
