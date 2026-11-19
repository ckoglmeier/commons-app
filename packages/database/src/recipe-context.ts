import { outcomeStaleness, type RecipeContext, type TripDatesLocation } from "@commons/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import { CommandConflictError, commandFingerprint, type CommandTransaction } from "./event-command";
import { readPollEvidence } from "./poll-evidence";
import { publishedPollReplacement } from "./poll-delivery-repository";
import { commons, pollDecisions, pollDrafts, polls, recipeOutcomes, recipeRuns } from "./schema";

/** Call only after active-organizer authorization. Uses the same immutable outcomes
 * and poll evidence as review, without reading chats, private bookings or intake. */
export async function readRecipeContext(tx: CommandTransaction, commonsId: string, trip: TripDatesLocation): Promise<RecipeContext> {
  const selected = [];
  for (const kind of ["dates_location", "attendance"] as const) {
    const [row] = await tx.select({ outcome: recipeOutcomes, decision: pollDecisions, runStatus: recipeRuns.status }).from(recipeOutcomes)
      .innerJoin(recipeRuns, eq(recipeRuns.id, recipeOutcomes.runId))
      .innerJoin(pollDecisions, eq(pollDecisions.id, recipeOutcomes.decisionId))
      .where(and(eq(recipeRuns.commonsId, commonsId), eq(recipeOutcomes.kind, kind), inArray(recipeOutcomes.status, ["approved", "applied"])))
      .orderBy(desc(recipeOutcomes.createdAt), desc(recipeOutcomes.id)).limit(1);
    if (row) selected.push(row);
  }
  const attendanceRow = selected.find(row => row.outcome.result.kind === "attendance");
  const attendanceResult = attendanceRow?.outcome.result;
  const attendance = attendanceResult?.kind === "attendance" ? {
    outcomeId: attendanceRow!.outcome.id, in: attendanceResult.headcount.in, maybe: attendanceResult.headcount.maybe,
    people: attendanceResult.people.map(person => ({ name: person.name, state: person.state, partySize: person.partySize })),
  } : null;
  const sources: RecipeContext["sources"] = [];
  for (const { outcome, decision, runStatus } of selected) {
    const [poll] = await tx.select().from(polls).where(and(eq(polls.id, outcome.pollId), eq(polls.commonsId, commonsId)));
    if (!poll) continue;
    const [latestDraft] = await tx.select({ publishedPollId: pollDrafts.publishedPollId, archivedAt: pollDrafts.archivedAt }).from(pollDrafts)
      .where(eq(pollDrafts.runId, outcome.runId)).orderBy(desc(pollDrafts.createdAt)).limit(1);
    const reconsidering = runStatus === "active" && latestDraft && !latestDraft.archivedAt && latestDraft.publishedPollId !== outcome.pollId;
    const { evidence } = await readPollEvidence(tx, poll);
    // Applying the dates decision is its own authorized write, not evidence drift.
    const normalized = outcome.status === "applied" && outcome.appliedTargets?.dates
      ? { ...evidence, event: { startsOn: outcome.base.startsOn, endsOn: outcome.base.endsOn } } : evidence;
    const currentEvidenceFingerprint = commandFingerprint("", "poll_evidence", normalized);
    const stale = outcomeStaleness(outcome, { trip, attendance: attendance ? {
      outcomeId: attendance.outcomeId, headcountIn: attendance.in, headcountMaybe: attendance.maybe,
    } : null }).map(reason => reason.message);
    if (poll.status !== "closed" || await publishedPollReplacement(tx, poll.id) || currentEvidenceFingerprint !== decision.evidenceFingerprint)
      stale.push("The source round or its answers changed after this decision was reviewed.");
    const approval = decision.approval as { needResolutions?: Array<{ responseId: string; questionId: string; resolution: string }> };
    // The approved snapshot, not later answers, supplies the needs carried forward.
    const approvedEvidence = decision.evidence as typeof evidence;
    const needs = (approvedEvidence.responses ?? []).flatMap(response => response.answers.flatMap(answer => answer.context?.kind === "need" ? [{
      name: response.respondentName, text: answer.context.text,
      resolution: approval.needResolutions?.find(item => item.responseId === response.id && item.questionId === answer.questionId)?.resolution ?? null,
    }] : []));
    sources.push({ runId: outcome.runId, outcomeId: outcome.id, decisionId: decision.id, pollId: poll.id,
      kind: outcome.kind as "dates_location" | "attendance", status: outcome.status as "approved" | "applied",
      evidenceFingerprint: decision.evidenceFingerprint, currentEvidenceFingerprint,
      approvedByName: outcome.approvedByName, approvedAt: decision.createdAt.toISOString(), stale,
      ...(reconsidering ? { reconsidering: true } : {}),
      conditions: "exceptions" in outcome.result ? outcome.result.exceptions : [], needs });
  }
  const value = { version: 1 as const, trip, sources, attendance };
  return { ...value, fingerprint: commandFingerprint("", "recipe_context_v1", value) };
}

export function recipeContextChanged(saved: RecipeContext | undefined, current: RecipeContext) {
  if (!saved) return true;
  const { fingerprint, ...value } = saved;
  return fingerprint !== current.fingerprint || fingerprint !== commandFingerprint("", "recipe_context_v1", value);
}

/** Runs inside the canonical publication transaction, including direct clients. */
export async function assertRecipePublicationContext(tx: CommandTransaction, commonsId: string, runId: string | null, saved: RecipeContext | undefined) {
  if (!runId) return;
  const [run] = await tx.select({ recipe: recipeRuns.recipe }).from(recipeRuns).where(and(eq(recipeRuns.id, runId), eq(recipeRuns.commonsId, commonsId)));
  if (run?.recipe !== "lodging") return;
  const [trip] = await tx.select().from(commons).where(eq(commons.id, commonsId));
  const current = await readRecipeContext(tx, commonsId, { startsOn: trip.startsOn, endsOn: trip.endsOn,
    locationNames: trip.locationNames.length ? trip.locationNames : trip.locationName ? [trip.locationName] : [] });
  if (!saved || recipeContextChanged(saved, current)) throw new CommandConflictError();
}
