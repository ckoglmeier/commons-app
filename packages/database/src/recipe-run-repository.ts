import { createHash } from "node:crypto";
import {
  SetRecipeDraftArchivedSchema, ApplyRecipeOutcomeSchema, PublishRecipeRoundSchema, RecipeOutcomeSchema, ReviseRecipeRoundSchema, StartRecipeRunSchema, approveSchemaFor, outcomeStaleness, recipeEntry, saveSchemaFor,
  deriveRecipeStage, type OutcomeView, type RecipeRunDetail, type RecipeRunSummary, type StaleReason, type TripDatesLocation,
  AdoptRecipeAdviceSchema, ApproveRecipeOutcomeSchema, MAX_RECIPE_ADVICE_ROUNDS, type RecipeEvidenceBundle, type RecipeEvidenceSource,
} from "@commons/contracts";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { createDatabase } from "./client";
import { isCommonsId } from "./commons-identifier";
import { CommandAccessError, CommandConflictError, commandFingerprint, runEventCommand, type CommandTransaction } from "./event-command";
import { assertRecipeAdviceFresh, deriveRecipeAdvice, recipeApprovalGuard, recipeEvidenceFingerprint, validateConnectedRecipeApproval, visibleRecipeEvidenceSource, type ConnectedRecipeDecisionEvidence } from "./recipe-advice";
import { publishedPollReplacement } from "./poll-delivery-repository";
import { readPollEvidence } from "./poll-evidence";
import { recordPollDecisionInTransaction } from "./poll-decision-repository";
import { reopenCoordinatorDraftInTransaction, saveCommonsPollDraftInTransaction } from "./poll-draft-repository";
import { createCommonsPoll, type PollRepositoryOptions } from "./poll-repository";
import { recipeHandler, type CurrentAttendance, type HandlerContext, type RecipeHandler } from "./recipe-handlers";
import { auditEvents, commons, memberships, people, pollDecisions, pollDrafts, pollResponses, polls, recipeOutcomes, recipeRuns } from "./schema";
import { pinnedWorkflowReference } from "./workflow-recipe-pin";
import { resolveWorkflowTemplateInTransaction } from "./workflow-repository";
import { operateCoordinatorGoalInTransaction, syncPlanningGoalArchive, resumeFoodCollectionGoal } from "./coordinator-goal-repository";
import { readRecipeContext, recipeContextChanged } from "./recipe-context";
import { participantRecipeSummary } from "@commons/contracts";
import { readFoodPlanningContext } from "./food-planning-context";

export class RecipeRunError extends Error {
  constructor(public readonly code: "run_not_found" | "trip_changed" | "not_ready" | "superseded", message: string) { super(message); this.name = "RecipeRunError"; }
}

/** A repeatable child command id: a retry of the parent command must reach the same child receipt. */
function derivedCommandId(commandId: string, label: string) {
  const hex = createHash("sha256").update(`${commandId}:${label}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const CommandEnvelope = z.object({ commandId: z.string().uuid() }).passthrough();

async function organizerEvent(tx: CommandTransaction, identifier: string, personId: string) {
  const [event] = await tx.select({ id: commons.id }).from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).for("update").limit(1);
  const [member] = event ? await tx.select({ role: memberships.role, status: memberships.status, name: people.displayName }).from(memberships).innerJoin(people, eq(people.id, memberships.personId))
    .where(and(eq(memberships.commonsId, event.id), eq(memberships.personId, personId))).limit(1) : [];
  if (!event || member?.status !== "active" || member.role !== "organizer") throw new CommandAccessError();
  return { id: event.id, actorName: member.name };
}
function requireOrganizer(context: { role: "organizer" | "member" }) { if (context.role !== "organizer") throw new CommandAccessError(); }

export function tripDatesLocation(row: { startsOn: string | null; endsOn: string | null; locationName: string | null; locationNames: string[] }): TripDatesLocation {
  const names = row.locationNames.length ? row.locationNames : row.locationName ? [row.locationName] : [];
  return { startsOn: row.startsOn, endsOn: row.endsOn, locationNames: names };
}
async function readTrip(tx: CommandTransaction, commonsId: string) {
  const [row] = await tx.select({ startsOn: commons.startsOn, endsOn: commons.endsOn, locationName: commons.locationName, locationNames: commons.locationNames }).from(commons).where(eq(commons.id, commonsId));
  return tripDatesLocation(row);
}
function sameTrip(a: TripDatesLocation, b: TripDatesLocation) {
  return a.startsOn === b.startsOn && a.endsOn === b.endsOn && a.locationNames.length === b.locationNames.length && a.locationNames.every((name, index) => name === b.locationNames[index]);
}

/** The latest approved attendance result for the trip: the headcount other recipes may plan against. Context only, never authority. */
async function currentAttendance(tx: CommandTransaction, commonsId: string): Promise<CurrentAttendance | null> {
  const [row] = await tx.select({ id: recipeOutcomes.id, result: recipeOutcomes.result, createdAt: recipeOutcomes.createdAt }).from(recipeOutcomes).innerJoin(recipeRuns, eq(recipeRuns.id, recipeOutcomes.runId))
    .where(and(eq(recipeRuns.commonsId, commonsId), eq(recipeOutcomes.kind, "attendance"), inArray(recipeOutcomes.status, ["approved", "applied"]))).orderBy(desc(recipeOutcomes.createdAt)).limit(1);
  if (!row || row.result.kind !== "attendance") return null;
  return { outcomeId: row.id, headcountIn: row.result.headcount.in, headcountMaybe: row.result.headcount.maybe, approvedAt: row.createdAt.toISOString() };
}
async function handlerContext(tx: CommandTransaction, commonsId: string, actorName: string): Promise<HandlerContext> {
  return { tx, commonsId, trip: await readTrip(tx, commonsId), attendance: await currentAttendance(tx, commonsId), actorName };
}
function handlerFor(recipe: string): RecipeHandler {
  const handler = recipeHandler(recipe);
  if (!handler) throw new RecipeRunError("not_ready", "That recipe doesn’t have a guided flow yet.");
  return handler;
}

/** Starts a run and its first private draft in one command. Nothing is shared or sent. */
export async function startRecipeRun(identifier: string, rawInput: unknown, options: PollRepositoryOptions & { createPlanningGoal?: boolean }) {
  const input = StartRecipeRunSchema.parse(rawInput);
  const handler = handlerFor(input.recipe);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(tx => runEventCommand(tx, { identifier, actorPersonId: options.actorPersonId, commandId: input.commandId, action: "recipe.run_started", input }, requireOrganizer, async context => {
      const template = await resolveWorkflowTemplateInTransaction(tx, recipeEntry(input.recipe).workflowKey);
      const workflow = pinnedWorkflowReference(template);
      await tx.insert(recipeRuns).values({ id: input.runId, commonsId: context.id, recipe: input.recipe, workflow, createdByPersonId: options.actorPersonId, commandId: input.commandId });
      const ctx = await handlerContext(tx, context.id, context.displayName);
      const data = { ...handler.draft(ctx, input, null), workflow,
        ...(input.recipe === "lodging" ? { recipeContext: await readRecipeContext(tx, context.id, ctx.trip) } : {}) };
      await saveCommonsPollDraftInTransaction(tx, identifier, { id: input.draftId, commandId: derivedCommandId(input.commandId, "draft"), expectedVersion: 0, data }, options);
      await tx.update(pollDrafts).set({ runId: input.runId, organizerShared: true }).where(eq(pollDrafts.id, input.draftId));
      const linked = options.createPlanningGoal ? await operateCoordinatorGoalInTransaction(tx, identifier, { op: "start", commandId: derivedCommandId(input.commandId, "goal"), kind: "planning", workflowRunId: input.runId, title: recipeEntry(input.recipe).title, goal: input.recipe === "dates_location" ? "Find a strong fit for dates and location with the least total effort for the group." : recipeEntry(input.recipe).summary }, { ...options, researchAvailable: false }) : null;
      if (linked) await tx.update(pollDrafts).set({ threadId: linked.goal.threadId }).where(eq(pollDrafts.id, input.draftId));
      return { result: { runId: input.runId, draftId: input.draftId, ...(linked ? { goalId: linked.goal.goalId } : {}) }, resourceType: "recipe_run", resourceId: input.runId, summary: `Started the ${recipeEntry(input.recipe).title.toLocaleLowerCase()} workflow with a private draft. Nothing was shared.` };
    }));
  } finally { await database.close(); }
}
export const startDatesLocationRun = startRecipeRun;

/** Reuse the same evidence guard for a Goal's explicit, revision-scoped completion. */
export async function assertPlanningGoalOutcome(tx: CommandTransaction, commonsId: string, runId: string, outcomeId: string) {
  const run = await loadRun(tx, commonsId, runId);
  const rounds = await readRounds(tx, runId), current = rounds.at(-1);
  if (run.status !== "active" || !current?.poll || current.superseded || current.poll.status !== "closed" || current.outcome?.id !== outcomeId || !["approved", "applied"].includes(current.outcome.status)) throw new CommandConflictError();
  const ctx = await handlerContext(tx, commonsId, "Organizer");
  if (stale(current.outcome, ctx).length) throw new CommandConflictError();
  if (run.recipe === "lodging" && current.draft.data.recipeContext && recipeContextChanged(current.draft.data.recipeContext, await readRecipeContext(tx, commonsId, ctx.trip))) throw new CommandConflictError();
  const [decision] = await tx.select().from(pollDecisions).where(eq(pollDecisions.id, current.outcome.decisionId));
  const currentEvidence = await readPollEvidence(tx, current.poll);
  // The reviewed application changes dates itself. Validate resulting dates via
  // staleness above, but compare ballots/audience/membership against the original
  // decision without treating that application's own date write as drift.
  const evidence = current.outcome.status === "applied" && current.outcome.appliedTargets?.dates ? { ...currentEvidence.evidence, event: { startsOn: current.outcome.base.startsOn, endsOn: current.outcome.base.endsOn } } : currentEvidence.evidence;
  if (!decision || decision.evidenceFingerprint !== commandFingerprint("", "poll_evidence", evidence)) throw new CommandConflictError();
  const connected = decision.evidence.recipeConnected as ConnectedRecipeDecisionEvidence | undefined;
  if (connected && current.outcome.result.kind === "dates_location") {
    const sourceTrip = current.outcome.status === "applied" ? { ...ctx.trip,
      ...(current.outcome.appliedTargets?.dates ? { startsOn: current.outcome.base.startsOn, endsOn: current.outcome.base.endsOn } : {}),
      ...(current.outcome.appliedTargets?.location ? { locationNames: current.outcome.base.locationNames } : {}) } : ctx.trip;
    const bundle = await connectedRecipeEvidence(tx, commonsId, runId, rounds, sourceTrip), result = current.outcome.result;
    if (!bundle.complete || connected.guardFingerprint !== recipeApprovalGuard(bundle, { id: result.alternativeId, startsOn: result.startsOn, endsOn: result.endsOn, place: result.place })) throw new CommandConflictError();
  }
}

async function loadRun(tx: CommandTransaction, commonsId: string, runId: string, lock = false) {
  const query = tx.select().from(recipeRuns).where(and(eq(recipeRuns.id, runId), eq(recipeRuns.commonsId, commonsId)));
  const [run] = lock ? await query.for("update") : await query;
  if (!run) throw new RecipeRunError("run_not_found", "That recipe run isn’t available.");
  return run;
}

export async function saveRecipeInputs(identifier: string, runId: string, rawInput: unknown, options: PollRepositoryOptions) {
  const { commandId } = CommandEnvelope.parse(rawInput);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(tx => runEventCommand(tx, { identifier, actorPersonId: options.actorPersonId, commandId, action: "recipe.inputs_saved", input: { runId, input: rawInput } }, requireOrganizer, async context => {
      const run = await loadRun(tx, context.id, runId, true);
      const schema = saveSchemaFor[run.recipe as keyof typeof saveSchemaFor];
      if (!schema) throw new RecipeRunError("not_ready", "That recipe doesn’t have a guided flow yet.");
      const input = schema.parse(rawInput) as { expectedDraftVersion: number };
      const [draft] = await tx.select().from(pollDrafts).where(eq(pollDrafts.runId, runId)).orderBy(desc(pollDrafts.createdAt)).limit(1).for("update");
      if (!draft || draft.publishedPollId || draft.archivedAt || draft.version !== input.expectedDraftVersion) throw new CommandConflictError();
      await validateRecipeSource(tx, context.id, runId, draft.data.sourcePollId);
      const ctx = await handlerContext(tx, context.id, context.displayName);
      const currentContext = run.recipe === "lodging" ? await readRecipeContext(tx, context.id, ctx.trip) : null;
      const review = rawInput as { reviewedContextFingerprint?: string; intro?: string | null };
      if (currentContext && recipeContextChanged(draft.data.recipeContext, currentContext) && review.reviewedContextFingerprint !== currentContext.fingerprint)
        throw new RecipeRunError("trip_changed", "Saved dates or attendance changed. Review the updated context and poll introduction before saving.");
      if (review.reviewedContextFingerprint && review.reviewedContextFingerprint !== currentContext?.fingerprint) throw new CommandConflictError();
      const rebuilt = handlerFor(run.recipe).draft(ctx, { ...input, title: (input as { title?: string }).title ?? draft.data.title }, draft.data);
      // Property editing must not overwrite manually refined wording or extra
      // questions. Only the typed property/sleeping/children fields are rebuilt.
      const data = { ...draft.data, ...rebuilt, ...(currentContext ? { recipeContext: currentContext } : {}) };
      if (run.recipe === "lodging") data.intro = review.intro !== undefined ? review.intro : draft.data.questions.length ? draft.data.intro : rebuilt.intro;
      const saved = await saveCommonsPollDraftInTransaction(tx, identifier, { id: draft.id, commandId: derivedCommandId(commandId, "draft"), expectedVersion: draft.version, data }, options);
      await tx.update(recipeRuns).set({ updatedAt: context.now }).where(eq(recipeRuns.id, runId));
      return { result: { draftId: saved.id, draftVersion: saved.version }, resourceType: "recipe_run", resourceId: runId, summary: "Updated the private draft." };
    }));
  } finally { await database.close(); }
}
export const saveRecipeAlternatives = saveRecipeInputs;

/** Recoverable deletion, only for a never-shared run. Shared rounds and decisions are untouched. */
export async function setRecipeDraftArchived(identifier: string, runId: string, rawInput: unknown, options: PollRepositoryOptions) {
  const input = SetRecipeDraftArchivedSchema.parse(rawInput), database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(tx => runEventCommand(tx, { identifier, actorPersonId: options.actorPersonId, commandId: input.commandId,
      action: input.archived ? "recipe.draft_deleted" : "recipe.draft_restored", input: { runId, ...input } }, requireOrganizer, async context => {
      const run = await loadRun(tx, context.id, runId, true);
      const drafts = await tx.select().from(pollDrafts).where(eq(pollDrafts.runId, runId)).for("update");
      const draft = drafts[0];
      if (drafts.length !== 1 || !draft || draft.publishedPollId) throw new RecipeRunError("not_ready", "Only a draft that has never been shared can be deleted or restored.");
      if (draft.version !== input.expectedDraftVersion || (run.status === "archived") === input.archived || Boolean(draft.archivedAt) === input.archived) throw new CommandConflictError();
      await tx.update(pollDrafts).set({ archivedAt: input.archived ? context.now : null, version: draft.version + 1, updatedAt: context.now }).where(eq(pollDrafts.id, draft.id));
      await tx.update(recipeRuns).set({ status: input.archived ? "archived" : "active", updatedAt: context.now }).where(eq(recipeRuns.id, runId));
      await syncPlanningGoalArchive(tx, context.id, runId, input.archived, context.now);
      return { result: { runId, draftVersion: draft.version + 1, archived: input.archived }, resourceType: "recipe_run", resourceId: runId,
        summary: input.archived ? "Deleted an unshared draft. It can be restored from Deleted drafts." : "Restored an unshared draft." };
    }));
  } finally { await database.close(); }
}

type Round = { draft: typeof pollDrafts.$inferSelect; poll: typeof polls.$inferSelect | null; responseCount: number; superseded: boolean; outcome: typeof recipeOutcomes.$inferSelect | null };

async function readRounds(tx: CommandTransaction, runId: string): Promise<Round[]> {
  const drafts = await tx.select().from(pollDrafts).where(eq(pollDrafts.runId, runId)).orderBy(asc(pollDrafts.createdAt));
  const rounds: Round[] = [];
  for (const draft of drafts) {
    const [poll] = draft.publishedPollId ? await tx.select().from(polls).where(eq(polls.id, draft.publishedPollId)) : [];
    const [count] = poll ? await tx.select({ n: sql<number>`count(*)::int` }).from(pollResponses).where(eq(pollResponses.pollId, poll.id)) : [{ n: 0 }];
    const [outcome] = poll ? await tx.select().from(recipeOutcomes).where(eq(recipeOutcomes.pollId, poll.id)) : [];
    rounds.push({ draft, poll: poll ?? null, responseCount: count.n, superseded: poll ? Boolean(await publishedPollReplacement(tx, poll.id)) : false, outcome: outcome ?? null });
  }
  return rounds;
}

/** Shared display state; no extra lifecycle or stored task is introduced. */
export async function planningGoalProgress(tx: CommandTransaction, tripId: string, runId: string) {
  const run = await loadRun(tx, tripId, runId);
  const round = (await readRounds(tx, runId)).at(-1);
  if (!round) return undefined;
  const stage = roundStage(round);
  let label = stage === "draft" ? "Drafting" : stage === "decide" ? "Answers ready to review" : stage === "decided" || stage === "applied" ? "Outcome ready to review" : stage === "closed" ? "Round closed" : "Collecting answers";
  let nextAction = stage === "draft" ? "Continue the saved draft, then review what the group will see." : stage === "decide" ? "Review the answers and any unresolved needs before recording a decision." : stage === "decided" || stage === "applied" ? "Review whether the recorded outcome meets this goal." : stage === "closed" ? "Open the saved round and its history." : "Keep collecting answers, or close voting when you’re ready to review.";
  let action: "continue_draft" | "close_voting" | "review_answers" | "review_outcome" | "view_round" | "wait" = stage === "draft" ? "continue_draft" : stage === "decide" ? "review_answers" : stage === "decided" || stage === "applied" ? "review_outcome" : stage === "closed" ? "view_round" : "wait";
  if (stage === "decide" && !round.responseCount) {
    label = "Voting closed · no answers";
    nextAction = "No answers were received. Review the round before deciding whether to ask again.";
    action = "view_round";
  }
  if (round.poll?.audience && ["shared", "collecting"].includes(stage)) {
    const responses = await tx.select({ personId: pollResponses.respondentPersonId }).from(pollResponses).where(eq(pollResponses.pollId, round.poll.id));
    const answered = new Set(responses.map(response => response.personId));
    const missing = round.poll.audience.personIds.filter(id => !answered.has(id));
    label = missing.length ? `Waiting on ${missing.length} ${missing.length === 1 ? "person" : "people"}` : responses.length ? "Answers ready to review" : "No one is included in this round";
    if (!missing.length && responses.length) { nextAction = "Close voting, then review the answers and any unresolved needs."; action = "close_voting"; }
  }
  if (run.recipe === "food_preferences" && stage !== "draft" && stage !== "closed") {
    label = round.responseCount ? "Food answers saved for planning" : round.poll?.status === "closed" ? "Voting closed · no answers" : "Waiting for food preferences";
    // A closed poll collects nothing more, so its link is no longer the next step.
    nextAction = round.responseCount ? "Review the saved answers. The Coordinator can use them for meal planning; no separate recording is needed."
      : round.poll?.status === "closed" ? "No answers were received. Start another round to ask again." : "Share the poll link to collect food preferences.";
    action = round.responseCount ? "review_answers" : "view_round";
    if (round.poll?.status === "closed" && round.responseCount) { label = "Food collection finished"; nextAction = "Saved answers remain available for advice. No meal arrangement or allergy accommodation is confirmed."; action = "view_round"; }
  }
  if (round.outcome && run.recipe !== "food_preferences") {
    const ctx = await handlerContext(tx, tripId, "Organizer");
    if (stale(round.outcome, ctx).length || run.recipe === "lodging" && recipeContextChanged(round.draft.data.recipeContext, await readRecipeContext(tx, tripId, ctx.trip))) {
      label = "Review changed context";
      nextAction = "Dates, attendance or source decisions changed. Review the saved outcome before reusing it.";
    }
  }
  return { runId, stage, label, nextAction, action };
}

/** A lineage reference must resolve through this run's drafts, never merely to another poll on the trip. */
async function validateRecipeSource(tx: CommandTransaction, commonsId: string, runId: string, sourcePollId: string | undefined) {
  if (!sourcePollId) return;
  const [source] = await tx.select({ id: polls.id }).from(pollDrafts).innerJoin(polls, eq(polls.id, pollDrafts.publishedPollId))
    .where(and(eq(pollDrafts.runId, runId), eq(pollDrafts.commonsId, commonsId), eq(polls.commonsId, commonsId), eq(polls.id, sourcePollId))).limit(1);
  if (!source) throw new RecipeRunError("not_ready", "That evidence source does not belong to this recipe run.");
}

async function connectedRecipeEvidence(tx: CommandTransaction, commonsId: string, runId: string, rounds: Round[], trip: TripDatesLocation): Promise<RecipeEvidenceBundle> {
  const current = rounds.at(-1)!;
  await validateRecipeSource(tx, commonsId, runId, current.draft.data.sourcePollId);
  const currentAudience = await tx.select({ personId: people.id, name: people.displayName, status: memberships.status }).from(memberships).innerJoin(people, eq(people.id, memberships.personId))
    .where(and(eq(memberships.commonsId, commonsId), inArray(memberships.status, ["active", "invited"]))).orderBy(asc(people.id));
  const published = rounds.filter(round => round.poll);
  const sources: RecipeEvidenceSource[] = [];
  for (const round of published.slice(-MAX_RECIPE_ADVICE_ROUNDS)) {
    const poll = round.poll!;
    if (poll.commonsId !== commonsId || round.draft.commonsId !== commonsId) throw new RecipeRunError("not_ready", "A round has an invalid evidence source.");
    const rows = await tx.select({ responseId: pollResponses.id, personId: pollResponses.respondentPersonId, name: pollResponses.respondentName, answers: pollResponses.answers, updatedAt: pollResponses.updatedAt })
      .from(pollResponses).where(eq(pollResponses.pollId, poll.id)).orderBy(asc(pollResponses.id));
    const responses = rows.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
    const resolvedNeeds: RecipeEvidenceSource["resolvedNeeds"] = [];
    const source: RecipeEvidenceSource = { pollId: poll.id, round: rounds.indexOf(round) + 1, fingerprint: "", status: poll.status, ballotMode: poll.ballotMode,
      audience: poll.audience, superseded: round.superseded, questions: poll.questions, responses, responseFingerprint: commandFingerprint("", "recipe_round_responses_v1", responses), hiddenResponseCount: 0, resolvedNeeds,
      approvedOutcome: round.outcome ? { id: round.outcome.id, status: round.outcome.status, alternativeId: round.outcome.result.kind === "dates_location" ? round.outcome.result.alternativeId : null } : null };
    source.fingerprint = commandFingerprint("", "recipe_round_evidence_v1", { ...source, fingerprint: undefined });
    sources.push(visibleRecipeEvidenceSource(source));
  }
  const partial = { runId, commonsId, complete: published.length <= MAX_RECIPE_ADVICE_ROUNDS, trip,
    currentAudience: currentAudience as RecipeEvidenceBundle["currentAudience"],
    draft: { id: current.draft.id, version: current.draft.version, published: Boolean(current.draft.publishedPollId), questions: current.draft.data.questions }, sources };
  const bundle: RecipeEvidenceBundle = { ...partial, fingerprint: "" };
  // Only the current, unchanged outcome may resolve earlier needs, and only for its exact chosen alternative.
  if (current.outcome?.result.kind === "dates_location" && current.outcome.status !== "superseded") {
    const [decision] = await tx.select({ evidence: pollDecisions.evidence, approval: pollDecisions.approval }).from(pollDecisions).where(eq(pollDecisions.id, current.outcome.decisionId));
    const connected = decision?.evidence.recipeConnected as ConnectedRecipeDecisionEvidence | undefined;
    const result = current.outcome.result, selected = { id: result.alternativeId, startsOn: result.startsOn, endsOn: result.endsOn, place: result.place };
    let reviewBundle = bundle;
    if (connected && current.outcome.status === "applied" && current.outcome.appliedTargets) {
      const expectedApplied = { ...connected.trip, ...(current.outcome.appliedTargets.dates ? { startsOn: result.startsOn, endsOn: result.endsOn } : {}), ...(current.outcome.appliedTargets.location ? { locationNames: [result.place] } : {}) };
      if (sameTrip(trip, expectedApplied)) reviewBundle = { ...bundle, trip: connected.trip };
    }
    if (connected?.version === 1 && connected.runId === runId && connected.commonsId === commonsId && connected.selectedAlternative.id === selected.id && connected.guardFingerprint === recipeApprovalGuard(reviewBundle, selected)) {
      bundle.reviewedAlternativeId = selected.id;
      for (const resolution of connected.priorNeedResolutions) bundle.sources.find(source => source.pollId === resolution.pollId)?.resolvedNeeds.push({ responseId: resolution.responseId, questionId: resolution.questionId, text: resolution.text });
      const currentSource = bundle.sources.find(source => source.pollId === current.poll?.id);
      for (const resolution of decision.approval.needResolutions) {
        const answer = currentSource?.responses.find(response => response.responseId === resolution.responseId)?.answers.find(answer => answer.questionId === resolution.questionId);
        if (answer?.context?.kind === "need") currentSource?.resolvedNeeds.push({ responseId: resolution.responseId, questionId: resolution.questionId, text: answer.context.text });
      }
    }
  }
  const { fingerprint: _fingerprint, ...fresh } = bundle;
  bundle.fingerprint = recipeEvidenceFingerprint(fresh);
  return bundle;
}
function roundStage(round: Round) {
  return deriveRecipeStage({ draft: { archived: Boolean(round.draft.archivedAt), publishedPollId: round.draft.publishedPollId },
    poll: round.poll ? { status: round.poll.status, responseCount: round.responseCount, superseded: round.superseded } : null,
    outcome: round.outcome ? { status: round.outcome.status } : null });
}
function stale(outcome: typeof recipeOutcomes.$inferSelect | null, ctx: HandlerContext): StaleReason[] {
  if (!outcome) return [];
  return outcomeStaleness({ status: outcome.status, result: outcome.result, appliedTargets: outcome.appliedTargets },
    { trip: ctx.trip, attendance: ctx.attendance ? { outcomeId: ctx.attendance.outcomeId, headcountIn: ctx.attendance.headcountIn, headcountMaybe: ctx.attendance.headcountMaybe } : null });
}

export async function listRecipeRuns(identifier: string, options: PollRepositoryOptions, includeArchived = false): Promise<RecipeRunSummary[]> {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const event = await organizerEvent(tx, identifier, options.actorPersonId);
      const ctx = await handlerContext(tx, event.id, event.actorName);
      const currentContext = await readRecipeContext(tx, event.id, ctx.trip);
      const runs = await tx.select().from(recipeRuns).where(and(eq(recipeRuns.commonsId, event.id), includeArchived ? undefined : eq(recipeRuns.status, "active"))).orderBy(desc(recipeRuns.updatedAt));
      const result: RecipeRunSummary[] = [];
      for (const run of runs) {
        const rounds = await readRounds(tx, run.id), current = rounds.at(-1) ?? null;
        // Staleness belongs to the result that is still current, so look at the latest outcome across rounds that is not superseded.
        const live = [...rounds].reverse().find(round => round.outcome && round.outcome.status !== "superseded")?.outcome ?? null;
        result.push({ id: run.id, recipe: run.recipe, title: current?.draft.data.title || recipeEntry(run.recipe).title, stage: current ? roundStage(current) : "draft",
          archived: run.status === "archived", draftVersion: current?.draft.version, canDelete: rounds.length === 1 && !current?.draft.publishedPollId,
          draftId: current?.draft.id ?? null, pollId: current?.poll?.id ?? null, responseCount: current?.responseCount ?? 0,
          outcomeStatus: current?.outcome?.status ?? null, updatedAt: (current?.draft.updatedAt ?? run.updatedAt).toISOString(), rounds: rounds.length,
          stale: [...stale(live, ctx), ...(run.recipe === "lodging" && !stale(live, ctx).length && recipeContextChanged(current?.draft.data.recipeContext, currentContext) ? [{ field: "context" as const, message: "Dates, attendance or source decisions changed. Review the saved planning context." }] : [])] });
      }
      return result;
    });
  } finally { await database.close(); }
}

export async function getRecipeRun(identifier: string, runId: string, options: PollRepositoryOptions): Promise<RecipeRunDetail> {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const event = await organizerEvent(tx, identifier, options.actorPersonId);
      const run = await loadRun(tx, event.id, runId);
      const rounds = await readRounds(tx, runId), current = rounds.at(-1);
      if (!current) throw new RecipeRunError("run_not_found", "That recipe run has no draft.");
      const handler = handlerFor(run.recipe), ctx = await handlerContext(tx, event.id, event.actorName);
      const currentContext = run.recipe === "lodging" ? await readRecipeContext(tx, event.id, ctx.trip) : null;
      const view = await handler.view(ctx, current.poll, current.draft.data);
      const connectedEvidence = run.recipe === "dates_location" ? await connectedRecipeEvidence(tx, event.id, runId, rounds, ctx.trip) : null;
      const evidence = current.poll && current.poll.status === "closed" && !current.superseded && !current.outcome ? (await readPollEvidence(tx, current.poll)).fingerprint : null;
      const [decision] = current.outcome ? await tx.select({ createdAt: pollDecisions.createdAt, summary: pollDecisions.summary }).from(pollDecisions).where(eq(pollDecisions.id, current.outcome.decisionId)) : [];
      const publicationAudience = await tx.select({ name: people.displayName }).from(memberships).innerJoin(people, eq(people.id, memberships.personId))
        .where(and(eq(memberships.commonsId, event.id), inArray(memberships.status, ["active", "invited"]))).orderBy(asc(people.displayName));
      const outcome: OutcomeView | null = current.outcome && decision ? { id: current.outcome.id, status: current.outcome.status, result: RecipeOutcomeSchema.parse(current.outcome.result), base: current.outcome.base,
        approvedByName: current.outcome.approvedByName, approvedAt: decision.createdAt.toISOString(), appliedAt: current.outcome.appliedAt?.toISOString() ?? null,
        appliedTargets: current.outcome.appliedTargets, stale: [...stale(current.outcome, ctx), ...(currentContext && !stale(current.outcome, ctx).length && recipeContextChanged(current.draft.data.recipeContext, currentContext) ? [{ field: "context" as const, message: "A source decision or planning context changed. Review before reusing this outcome." }] : [])] } : null;
      return {
        id: run.id, recipe: run.recipe, title: current.draft.data.title, intro: current.draft.data.intro, workflow: { key: run.workflow.key, version: run.workflow.version }, stage: roundStage(current),
        participantPreview: { title: current.draft.data.title, intro: current.draft.data.intro, questions: current.draft.data.questions as never },
        publicationAudience: publicationAudience.map(person => person.name),
        ...(decision && current.poll ? { participantDecision: { summary: participantRecipeSummary(current.outcome?.result), publicId: current.poll.publicId } } : {}),
        draft: { id: current.draft.id, version: current.draft.version, published: Boolean(current.draft.publishedPollId), archived: Boolean(current.draft.archivedAt) },
        poll: current.poll ? { id: current.poll.id, publicId: current.poll.publicId, status: current.poll.status, responseCount: current.responseCount, superseded: current.superseded,
          audienceKind: current.poll.audience ? "invitees" as const : "link" as const, ballotMode: current.poll.ballotMode } : null,
        notes: view.notes, evidenceFingerprint: evidence, outcome, trip: ctx.trip, askedTrip: current.draft.data.recipeTrip ?? null,
        ...(currentContext ? { context: { saved: current.draft.data.recipeContext ?? null, current: currentContext, changed: recipeContextChanged(current.draft.data.recipeContext, currentContext) } } : {}),
        headcount: ctx.attendance ? { outcomeId: ctx.attendance.outcomeId, in: ctx.attendance.headcountIn, maybe: ctx.attendance.headcountMaybe, approvedAt: ctx.attendance.approvedAt } : null,
        history: rounds.slice(0, -1).map(round => ({ pollId: round.poll?.id ?? null, stage: roundStage(round), outcomeStatus: round.outcome?.status ?? null, responseCount: round.responseCount })),
        ...(connectedEvidence ? { connectedEvidence, advice: deriveRecipeAdvice(connectedEvidence) } : {}),
        ...(run.recipe === "food_preferences" ? { earlierFoodAnswers: (await readFoodPlanningContext(tx, event.id, new Date().toISOString(), runId)).filter(source => source.value.roundState === "earlier") } : {}),
        ...view.detail as Partial<RecipeRunDetail>,
      } as RecipeRunDetail;
    });
  } finally { await database.close(); }
}

/** Adopts only the current server-derived question subset into an existing private draft. No publish, vote or trip command is called. */
export async function adoptRecipeAdvice(identifier: string, runId: string, rawInput: unknown, options: PollRepositoryOptions) {
  const input = AdoptRecipeAdviceSchema.parse(rawInput), database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(tx => runEventCommand(tx, { identifier, actorPersonId: options.actorPersonId, commandId: input.commandId,
      action: "recipe.advice_adopted", input: { runId, ...input } }, requireOrganizer, async context => {
      const run = await loadRun(tx, context.id, runId, true);
      if (run.recipe !== "dates_location") throw new RecipeRunError("not_ready", "This recipe does not have convergence advice.");
      const rounds = await readRounds(tx, runId), current = rounds.at(-1);
      if (!current || current.poll || current.draft.archivedAt || current.draft.version !== input.expectedDraftVersion) throw new CommandConflictError();
      // Response commands lock the poll. Hold the same lock while checking all source evidence and saving the private draft.
      const ids = rounds.flatMap(round => round.poll ? [round.poll.id] : []);
      if (ids.length) await tx.select({ id: polls.id }).from(polls).where(inArray(polls.id, ids)).orderBy(asc(polls.id)).for("update");
      for (const id of input.sourcePollIds) await validateRecipeSource(tx, context.id, runId, id);
      const ctx = await handlerContext(tx, context.id, context.displayName);
      const bundle = await connectedRecipeEvidence(tx, context.id, runId, await readRounds(tx, runId), ctx.trip);
      try { assertRecipeAdviceFresh(bundle, input.evidenceFingerprint, input.sourcePollIds); } catch (error) { throw new RecipeRunError("not_ready", (error as Error).message); }
      const advice = deriveRecipeAdvice(bundle);
      if (!advice.proposedConfiguration) throw new RecipeRunError("not_ready", "This recommendation has no new questions to adopt. Review its blockers or the existing round.");
      const rebuilt = handlerFor(run.recipe).draft(ctx, { configuration: advice.proposedConfiguration, title: current.draft.data.title }, current.draft.data);
      const saved = await saveCommonsPollDraftInTransaction(tx, identifier, { id: current.draft.id, commandId: derivedCommandId(input.commandId, "draft"), expectedVersion: current.draft.version, data: { ...current.draft.data, ...rebuilt } }, options);
      await tx.update(recipeRuns).set({ updatedAt: context.now }).where(eq(recipeRuns.id, runId));
      return { result: { draftId: saved.id, draftVersion: saved.version, evidenceFingerprint: bundle.fingerprint }, resourceType: "recipe_run", resourceId: runId,
        summary: "Adopted rules-based questions into the private draft. Nothing was shared and no answers were carried forward." };
    }));
  } finally { await database.close(); }
}

const ApprovalEnvelope = z.object({ commandId: z.string().uuid(), pollId: z.string().uuid(), evidenceFingerprint: z.string().length(64) }).passthrough();

/** Approves one typed result from the closed round. The poll decision stays the approval record; nothing on the trip changes. */
export async function approveRecipeOutcome(identifier: string, runId: string, rawInput: unknown, options: PollRepositoryOptions) {
  const envelope = ApprovalEnvelope.parse(rawInput);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(tx => runEventCommand(tx, { identifier, actorPersonId: options.actorPersonId, commandId: envelope.commandId, action: "recipe.outcome_approved", input: { runId, input: rawInput } }, requireOrganizer, async context => {
      const run = await loadRun(tx, context.id, runId, true);
      if (!(run.recipe in approveSchemaFor)) throw new RecipeRunError("not_ready", "That recipe doesn’t have a guided flow yet.");
      const [draft] = await tx.select({ id: pollDrafts.id, data: pollDrafts.data }).from(pollDrafts).where(and(eq(pollDrafts.runId, runId), eq(pollDrafts.publishedPollId, envelope.pollId)));
      const [poll] = draft ? await tx.select().from(polls).where(and(eq(polls.id, envelope.pollId), eq(polls.commonsId, context.id))).for("update") : [];
      if (!poll) throw new RecipeRunError("run_not_found", "That round doesn’t belong to this recipe run.");
      if (poll.status !== "closed") throw new RecipeRunError("not_ready", "Close voting before approving a result.");
      if (await publishedPollReplacement(tx, poll.id)) throw new RecipeRunError("superseded", "This round was replaced. Review the newer round instead.");
      const approvalContext = await handlerContext(tx, context.id, context.displayName);
      if (run.recipe === "lodging" && draft.data.recipeContext) {
        const currentContext = await readRecipeContext(tx, context.id, approvalContext.trip);
        const expectedContext = (rawInput as { contextFingerprint?: string }).contextFingerprint;
        if (recipeContextChanged(draft.data.recipeContext, currentContext) || expectedContext && expectedContext !== currentContext.fingerprint)
          throw new RecipeRunError("trip_changed", "Planning context changed or has not been reviewed. Review the current dates, attendance and carried needs before recording a preference.");
      }
      if (run.recipe === "attendance" || run.recipe === "lodging") {
        if (!draft.data.recipeTrip) throw new RecipeRunError("not_ready", "This older round has no saved question context. Revise it and update the draft before asking again.");
        approvalContext.trip = draft.data.recipeTrip;
      }
      const approval = await handlerFor(run.recipe).approve(approvalContext, poll, rawInput);
      const trip = await readTrip(tx, context.id);
      let connectedRecipe: ConnectedRecipeDecisionEvidence | undefined;
      if (approval.result.kind === "dates_location") {
        const allRounds = await readRounds(tx, runId), ids = allRounds.flatMap(round => round.poll ? [round.poll.id] : []);
        if (ids.length) await tx.select({ id: polls.id }).from(polls).where(inArray(polls.id, ids)).orderBy(asc(polls.id)).for("update");
        const bundle = await connectedRecipeEvidence(tx, context.id, runId, await readRounds(tx, runId), trip);
        const result = approval.result;
        try { connectedRecipe = validateConnectedRecipeApproval(bundle, ApproveRecipeOutcomeSchema.parse(rawInput), { id: result.alternativeId, startsOn: result.startsOn, endsOn: result.endsOn, place: result.place }); }
        catch (error) { throw new RecipeRunError("not_ready", (error as Error).message); }
      }
      const decisionId = await recordPollDecisionInTransaction(tx, context, options.actorPersonId, poll.id,
        { commandId: derivedCommandId(envelope.commandId, "decision"), evidenceFingerprint: envelope.evidenceFingerprint, summary: approval.summary, target: "record",
          selected: approval.selected, needResolutions: approval.needResolutions, uncertaintyAcknowledged: true, audienceExpansionApproved: false }, { allowNoSelection: true, connectedRecipe });
      await tx.update(recipeOutcomes).set({ status: "superseded" }).where(and(eq(recipeOutcomes.runId, runId), ne(recipeOutcomes.pollId, poll.id), inArray(recipeOutcomes.status, ["approved", "applied"])));
      const [created] = await tx.insert(recipeOutcomes).values({ runId, pollId: poll.id, decisionId, kind: approval.result.kind, result: approval.result, base: trip, approvedByPersonId: options.actorPersonId, approvedByName: context.displayName }).returning({ id: recipeOutcomes.id });
      await tx.update(recipeRuns).set({ updatedAt: context.now }).where(eq(recipeRuns.id, runId));
      return { result: { outcomeId: created.id }, resourceType: "recipe_outcome", resourceId: created.id, summary: `Approved a ${approval.result.kind.replace("_", " and ")} result. No trip details changed.` };
    }));
  } finally { await database.close(); }
}

/** The only place a recipe changes trip records. It names its targets and refuses when the trip moved since the organizer looked. */
export async function applyRecipeOutcome(identifier: string, runId: string, rawInput: unknown, options: PollRepositoryOptions) {
  const input = ApplyRecipeOutcomeSchema.parse(rawInput);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(tx => runEventCommand(tx, { identifier, actorPersonId: options.actorPersonId, commandId: input.commandId, action: "recipe.outcome_applied", input: { runId, ...input } }, requireOrganizer, async context => {
      const [outcome] = await tx.select({ outcome: recipeOutcomes }).from(recipeOutcomes).innerJoin(recipeRuns, eq(recipeRuns.id, recipeOutcomes.runId))
        .where(and(eq(recipeOutcomes.id, input.outcomeId), eq(recipeRuns.id, runId), eq(recipeRuns.commonsId, context.id))).for("update");
      if (!outcome) throw new RecipeRunError("run_not_found", "That result isn’t available.");
      const result = outcome.outcome.result;
      if (result.kind !== "dates_location") throw new RecipeRunError("not_ready", "This result is a record for planning. It doesn’t change the trip.");
      if (outcome.outcome.status === "superseded" || await publishedPollReplacement(tx, outcome.outcome.pollId)) throw new RecipeRunError("superseded", "A newer result replaced this one. Review that result instead.");
      if (outcome.outcome.status !== "approved") throw new RecipeRunError("not_ready", "This result was already applied.");
      const current = await readTrip(tx, context.id);
      if (!sameTrip(current, input.expected)) throw new RecipeRunError("trip_changed", "The trip’s dates or location changed after you looked. Review the current details and try again.");
      const [decision] = await tx.select({ evidence: pollDecisions.evidence }).from(pollDecisions).where(eq(pollDecisions.id, outcome.outcome.decisionId));
      const connected = decision?.evidence.recipeConnected as ConnectedRecipeDecisionEvidence | undefined;
      if (connected) {
        const rounds = await readRounds(tx, runId), ids = rounds.flatMap(round => round.poll ? [round.poll.id] : []);
        if (ids.length) await tx.select({ id: polls.id }).from(polls).where(inArray(polls.id, ids)).orderBy(asc(polls.id)).for("update");
        const bundle = await connectedRecipeEvidence(tx, context.id, runId, await readRounds(tx, runId), current);
        const selected = { id: result.alternativeId, startsOn: result.startsOn, endsOn: result.endsOn, place: result.place };
        if (!bundle.complete || connected.version !== 1 || connected.runId !== runId || connected.commonsId !== context.id || connected.guardFingerprint !== recipeApprovalGuard(bundle, selected))
          throw new RecipeRunError("trip_changed", "Source answers, participant coverage or trip context changed after approval. Review a fresh outcome before updating the trip.");
      }
      const update: Partial<typeof commons.$inferInsert> = { updatedAt: context.now };
      if (input.applyDates) { update.startsOn = result.startsOn; update.endsOn = result.endsOn; }
      if (input.applyLocation) { update.locationName = result.place; update.locationNames = [result.place]; }
      await tx.update(commons).set(update).where(eq(commons.id, context.id));
      await tx.update(recipeOutcomes).set({ status: "applied", appliedAt: context.now, appliedByPersonId: options.actorPersonId, appliedTargets: { dates: input.applyDates, location: input.applyLocation } }).where(eq(recipeOutcomes.id, input.outcomeId));
      await tx.insert(auditEvents).values({ commonsId: context.id, commandId: derivedCommandId(input.commandId, "details"), actorId: options.actorPersonId, actorType: "human", action: "commons.details_updated",
        resourceType: "commons", resourceId: context.id, summary: `${context.displayName} updated the trip ${[input.applyDates ? "dates" : "", input.applyLocation ? "location" : ""].filter(Boolean).join(" and ")} from a reviewed recipe result.` });
      return { result: { outcomeId: input.outcomeId }, resourceType: "recipe_outcome", resourceId: input.outcomeId, summary: "Applied a reviewed date and location result to the trip." };
    }));
  } finally { await database.close(); }
}

/**
 * Publishes the saved draft exactly as stored; the client never supplies questions. Publication makes the poll available to the chosen
 * audience and sends nothing. The existing publication command still checks the draft version and a matching fingerprint.
 */
export async function publishRecipeRound(identifier: string, runId: string, rawInput: unknown, options: PollRepositoryOptions) {
  const input = PublishRecipeRoundSchema.parse(rawInput);
  const database = createDatabase(options.databaseUrl);
  let request: Record<string, unknown>;
  try {
    request = await database.db.transaction(async tx => {
      const event = await organizerEvent(tx, identifier, options.actorPersonId);
      await loadRun(tx, event.id, runId);
      const [draft] = await tx.select().from(pollDrafts).where(eq(pollDrafts.runId, runId)).orderBy(desc(pollDrafts.createdAt)).limit(1);
      if (!draft || draft.archivedAt) throw new RecipeRunError("run_not_found", "That recipe run has no draft.");
      await validateRecipeSource(tx, event.id, runId, draft.data.sourcePollId);
      if (draft.publishedPollId) { const [existing] = await tx.select({ commandId: polls.commandId }).from(polls).where(eq(polls.id, draft.publishedPollId)); if (existing?.commandId !== input.commandId) throw new CommandConflictError(); }
      else if (draft.version !== input.expectedDraftVersion) throw new CommandConflictError();
      return { ...draft.data, commandId: input.commandId, draftId: draft.id, draftVersion: input.expectedDraftVersion, publicationApproval: { approved: true, access: input.access } };
    });
  } finally { await database.close(); }
  const poll = await createCommonsPoll(identifier, request, options);
  return { pollId: poll.id, publicId: poll.publicId };
}

/** Closes the published round and starts a replacement draft in the same run. Earlier responses and decisions stay as history. */
export async function reviseRecipeRound(identifier: string, runId: string, rawInput: unknown, options: PollRepositoryOptions) {
  const input = ReviseRecipeRoundSchema.parse(rawInput);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(tx => runEventCommand(tx, { identifier, actorPersonId: options.actorPersonId, commandId: input.commandId,
      action: "recipe.round_revised", input: { runId, ...input } }, requireOrganizer, async context => {
      const run = await loadRun(tx, context.id, runId, true);
      const [draft] = await tx.select({ id: pollDrafts.id, publishedPollId: pollDrafts.publishedPollId }).from(pollDrafts).where(eq(pollDrafts.runId, runId)).orderBy(desc(pollDrafts.createdAt)).limit(1);
      if (!draft?.publishedPollId) throw new RecipeRunError("not_ready", "Publish the draft before revising it.");
      const replacement = await reopenCoordinatorDraftInTransaction(tx, identifier, draft.id, input.expectedDraftVersion, options);
      if (run.recipe === "food_preferences") await resumeFoodCollectionGoal(tx, context.id, runId, context.now);
      return { result: { draftId: replacement.id }, resourceType: "recipe_run", resourceId: runId, summary: "Started a replacement private draft. Earlier answers stay as history." };
    }));
  } finally { await database.close(); }
}
