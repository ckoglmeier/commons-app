import { pollResultsAreVisible } from "./poll-repository";
import { assertPlanningGoalOutcome, planningGoalProgress } from "./recipe-run-repository";
import { publishedPollReplacement } from "./poll-delivery-repository";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { CoordinatorGoalSchema, GoalOperationRequestSchema, GoalOutcomeSchema, isGoalTerminal, type CoordinatorGoal, type GoalEnvelope, type GoalOutcome, type GoalReport } from "@commons/contracts";
import { goalEnvelope, goalFinishLine, pollStepComplete } from "@commons/domain";
import { createDatabase } from "./client";
import { CommandAccessError, CommandConflictError, commandFingerprint, type CommandTransaction } from "./event-command";
import { assertCoordinatorTurnFenceInTransaction, requireTripOrganizer } from "./coordinator-turn-repository";
import { ensureMainThreadInTransaction } from "./coordinator-thread-link-repository";
import { queueResearchTaskInTransaction, taskRunId, type ResearchOptions } from "./research-task-repository";
import { commons, coordinatorGoals, coordinatorGoalSteps, coordinatorGoalEvents, coordinatorGoalReports, coordinatorThreads, coordinatorThreadLinks, coordinatorTurns, coordinatorTaskState, coordinatorTaskEvents, coordinatorResearchRuns, coordinatorOutreach, coordinatorOutreachMessages, itineraryItems, memberships, people, polls, pollDrafts, pollResponses, researchTasks, researchAttempts, recipeRuns, recipeOutcomes } from "./schema";

type Goal = typeof coordinatorGoals.$inferSelect;
type Step = typeof coordinatorGoalSteps.$inferSelect;
export type GoalOptions = ResearchOptions & { researchAvailable?: boolean; syntheticParticipants?: boolean; now?: Date;
  /** Server-only identity for an atomic reviewed workflow. Not goal/mutation authority. */
  reviewedWorkflowKey?: string };
export class GoalRevisionConflict extends CommandConflictError { constructor(readonly currentRevision: number) { super(); } }
const nowOf = (options: GoalOptions) => options.now ?? new Date();
const keyOf = (input: { kind: string; goal: string; ideaIds: string[] }) => commandFingerprint("", "goal-key", { kind: input.kind, goal: input.goal.trim().toLowerCase().replace(/\s+/g, " "), ideas: [...input.ideaIds].sort() });
const whereGoal = (id: string, trip: string) => and(eq(coordinatorGoals.id, id), eq(coordinatorGoals.commonsId, trip));

// Closing a live round can finish collection. Revoking access or replacing its
// immutable snapshot cannot: those ballots are historical evidence only.
async function currentGoalPoll(tx: CommandTransaction, tripId: string, pollId: string) {
  const [poll] = await tx.select().from(polls).where(and(eq(polls.id, pollId), eq(polls.commonsId, tripId))).for("share");
  return poll && poll.status !== "revoked" && !await publishedPollReplacement(tx, poll.id) ? poll : null;
}

async function report(tx: CommandTransaction, goal: Goal, kind: GoalReport["kind"], headline: string, now: Date, outcome?: GoalOutcome, discriminator = "") {
  await tx.insert(coordinatorGoalReports).values({ commonsId: goal.commonsId, goalId: goal.id, mainThreadId: goal.mainThreadId, goalRevision: goal.revision,
    kind, discriminator, headline: headline.slice(0, 240), detail: outcome?.detail ?? goal.waitDetail, sources: outcome?.sources ?? [], nextAction: kind === "needs_approval" ? "Review and approve on screen." : kind === "needs_input" ? goal.waitDetail?.slice(0,240) : "Open task", createdAt: now }).onConflictDoNothing();
}
async function wait(tx: CommandTransaction, goal: Goal, lifecycle: Goal["lifecycle"], detail: string, now: Date) {
  await tx.update(coordinatorGoals).set({ lifecycle, waitDetail: detail, updatedAt: now }).where(eq(coordinatorGoals.id, goal.id));
  Object.assign(goal, { lifecycle, waitDetail: detail });
  if (lifecycle === "waiting_for_input" || lifecycle === "waiting_for_approval") await report(tx, goal, lifecycle === "waiting_for_input" ? "needs_input" : "needs_approval", `${goal.title}: ${detail}`, now);
}
async function stopRuns(tx: CommandTransaction, goal: Goal, now: Date) {
  const steps = await tx.select().from(coordinatorGoalSteps).where(and(eq(coordinatorGoalSteps.goalId, goal.id), eq(coordinatorGoalSteps.goalRevision, goal.revision)));
  for (const step of steps) if (step.kind === "research" && step.refId) {
    await tx.update(researchTasks).set({ status: "cancelled", leaseExpiresAt: null, updatedAt: now }).where(and(eq(researchTasks.id, step.refId), inArray(researchTasks.status, ["pending", "processing", "needs_input"])));
    await tx.update(researchAttempts).set({ status: "cancelled", finishedAt: now }).where(and(eq(researchAttempts.taskId, step.refId), eq(researchAttempts.status, "processing")));
  }
  await tx.update(coordinatorGoalSteps).set({ status: "superseded" }).where(and(eq(coordinatorGoalSteps.goalId, goal.id), eq(coordinatorGoalSteps.goalRevision, goal.revision), inArray(coordinatorGoalSteps.status, ["pending", "running", "waiting"])));
}
async function beginSteps(tx: CommandTransaction, goal: Goal, options: GoalOptions) {
  const now = nowOf(options), params = goal.envelope.steps;
  const prior = await tx.select().from(coordinatorGoalSteps).where(eq(coordinatorGoalSteps.goalId, goal.id)).orderBy(desc(coordinatorGoalSteps.goalRevision));
  for (const [seq, value] of params.entries()) {
    // An amendment must not temporarily send a domain job to the legacy worker.
    // The server adapter rebinds fresh input; no old result/checkpoint is reused.
    const previous = prior.find(s => s.goalRevision < goal.revision && s.seq === seq && s.kind === value.kind && (s.result?.workflowExecution || s.result?.workflowExecutionPending));
    const binding = previous?.result?.workflowExecution ?? previous?.result?.workflowExecutionPending;
    const pending = binding && typeof binding === "object" ? { workflowExecutionPending: { handler: (binding as Record<string, unknown>).handler } } : {};
    await tx.insert(coordinatorGoalSteps).values({ goalId: goal.id, commonsId: goal.commonsId, goalRevision: goal.revision, seq, kind: value.kind, params: value, result: pending, createdAt: now }).onConflictDoNothing();
  }
  await advance(tx, goal, options);
}
async function completeStep(tx: CommandTransaction, goal: Goal, step: Step, outcome: GoalOutcome, options: GoalOptions) {
  const now = nowOf(options);
  await tx.update(coordinatorGoalSteps).set({ status: "done", result: { ...step.result, ...outcome }, finishedAt: now }).where(eq(coordinatorGoalSteps.id, step.id));
  await tx.update(coordinatorGoals).set({ outcome, outcomeRevision: goal.revision, updatedAt: now }).where(eq(coordinatorGoals.id, goal.id));
  Object.assign(goal, { outcome, outcomeRevision: goal.revision });
  await advance(tx, goal, options);
}

/** One bounded deterministic step. Waiting releases all work; no model loop. */
async function advance(tx: CommandTransaction, goal: Goal, options: GoalOptions) {
  const now = nowOf(options);
  if (isGoalTerminal(goal.lifecycle)) return;
  const [revisionStart] = await tx.select().from(coordinatorGoalSteps).where(and(eq(coordinatorGoalSteps.goalId, goal.id), eq(coordinatorGoalSteps.goalRevision, goal.revision))).orderBy(asc(coordinatorGoalSteps.seq)).limit(1);
  if (goal.kind !== "planning" && now.getTime() - (revisionStart?.createdAt ?? goal.createdAt).getTime() > goal.envelope.budget.maxDurationHours * 3600_000) {
    await stopRuns(tx, goal, now);
    await tx.update(coordinatorGoals).set({ lifecycle: "failed", errorCode: "deadline_exceeded", completedAt: now, updatedAt: now }).where(eq(coordinatorGoals.id, goal.id));
    Object.assign(goal,{lifecycle:"failed",errorCode:"deadline_exceeded",completedAt:now,updatedAt:now});
    await report(tx, goal, "failed", `${goal.title}: the task time limit was reached.`, now); return;
  }
  const steps = await tx.select().from(coordinatorGoalSteps).where(and(eq(coordinatorGoalSteps.goalId, goal.id), eq(coordinatorGoalSteps.goalRevision, goal.revision))).orderBy(asc(coordinatorGoalSteps.seq));
  const step = steps.find(value => value.status !== "done");
  if (!step) {
    await tx.update(coordinatorGoals).set({ lifecycle: "completed", waitDetail: null, completedAt: now, updatedAt: now }).where(eq(coordinatorGoals.id, goal.id));
    Object.assign(goal,{lifecycle:"completed",waitDetail:null,completedAt:now,updatedAt:now});
    await report(tx, goal, "completed", goal.outcome?.headline ?? `${goal.title} completed.`, now, goal.outcome ?? undefined); return;
  }
  if (step.status !== "pending" || goal.lifecycle === "waiting_for_input") return;
  if (step.params.kind === "planning") {
    await tx.update(coordinatorGoalSteps).set({ status: "waiting", refId: step.params.runId, startedAt: now }).where(eq(coordinatorGoalSteps.id, step.id));
    await wait(tx, goal, "waiting_for_approval", "Use the saved workflow to gather evidence, then review whether its outcome meets this goal. Poll responses alone do not complete it.", now);
    return;
  }
  if (step.params.kind === "research") {
    if (!options.researchAvailable) { await tx.update(coordinatorGoals).set({ lifecycle: "ready", waitDetail: "Research execution is unavailable. This task is planned; no search has started.", updatedAt: now }).where(eq(coordinatorGoals.id, goal.id)); return; }
    const receipt = await queueResearchTaskInTransaction(tx, { protocolVersion: 1, commandId: step.id, commonsId: goal.commonsId, threadId: goal.threadId, parentTaskId: null,
      caller: { kind: "human", personId: goal.createdByPersonId }, capability: "research.public_sources", input: { query: step.params.query }, routing: { kind: "commons_specialist" }, returnTo: { kind: "commons_thread", threadId: goal.threadId } }, { ...options, actorPersonId: goal.createdByPersonId }, { title: goal.title, brief: goal.goal, contextVersion: goal.contextVersion });
    await tx.update(coordinatorGoalSteps).set({ status: "running", refId: receipt.taskId, startedAt: now }).where(eq(coordinatorGoalSteps.id, step.id));
    await tx.update(coordinatorGoals).set({ lifecycle: "running", waitDetail: null, updatedAt: now }).where(eq(coordinatorGoals.id, goal.id)); return;
  }
  if (step.params.kind === "outreach") {
    if (!options.syntheticParticipants) { await wait(tx,goal,"waiting_for_input","Participant delivery is unavailable. No message has been sent.",now); return; }
    const [recipient]=await tx.select().from(people).where(eq(people.id,step.params.recipientPersonId));
    const [outreach]=await tx.insert(coordinatorOutreach).values({commonsId:goal.commonsId,goalId:goal.id,stepId:step.id,recipientPersonId:step.params.recipientPersonId,conversationAddress:`synthetic:${step.id}`,sendSnapshot:{recipientName:recipient.displayName,question:step.params.question,text:step.params.question},maxFollowUps:0,expiresAt:new Date(now.getTime()+48*3600_000),createdAt:now,updatedAt:now}).returning();
    await tx.update(coordinatorGoalSteps).set({refId:outreach.id,status:"waiting",startedAt:now}).where(eq(coordinatorGoalSteps.id,step.id));
    await wait(tx,goal,"waiting_for_approval","Review the exact recipient and question for synthetic delivery. No real message can be sent.",now);return;
  }
  await tx.update(coordinatorGoalSteps).set({ status: "waiting", startedAt: now }).where(eq(coordinatorGoalSteps.id, step.id));
  await wait(tx, goal, step.kind === "plan_action" ? "waiting_for_approval" : "waiting_for_input", step.kind === "poll" ? "Prepare and publish a poll, then link it to this task." : step.kind === "plan_action" ? "Prepare the exact plan update here, then link its review." : "Participant delivery is synthetic only; no message has been sent.", now);
}

/** Replay external saved state without inference. Repeated observations produce one result/report. */
async function reconcile(tx: CommandTransaction, goal: Goal, options: GoalOptions) {
  if (isGoalTerminal(goal.lifecycle)) return;
  const now = nowOf(options);
  const steps = await tx.select().from(coordinatorGoalSteps).where(and(eq(coordinatorGoalSteps.goalId, goal.id), eq(coordinatorGoalSteps.goalRevision, goal.revision))).orderBy(asc(coordinatorGoalSteps.seq));
  // A newly delivered event cannot satisfy work whose time budget already expired.
  if(goal.kind !== "planning" && now.getTime()-(steps[0]?.createdAt??goal.createdAt).getTime()>goal.envelope.budget.maxDurationHours*3600_000){await advance(tx,goal,options);return;}
  const step = steps.find(value => value.status !== "done");
  if (!step || !step.refId) { if (goal.lifecycle !== "waiting_for_input") await advance(tx, goal, options); return; }
  if (step.params.kind === "planning") {
    // Compatibility for existing shared Goal drafts: retain their records and
    // attach only unthreaded, unpublished work to its already-authorized Goal.
    await tx.update(pollDrafts).set({ threadId: goal.threadId }).where(and(eq(pollDrafts.commonsId, goal.commonsId),
      eq(pollDrafts.runId, step.params.runId), eq(pollDrafts.organizerShared, true), isNull(pollDrafts.threadId), isNull(pollDrafts.publishedPollId)));
    const [run] = await tx.select().from(recipeRuns).where(and(eq(recipeRuns.id, step.params.runId), eq(recipeRuns.commonsId, goal.commonsId)));
    if (run?.recipe === "food_preferences" && run.status === "active") {
      const [latest] = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.runId, run.id), eq(pollDrafts.commonsId, goal.commonsId))).orderBy(desc(pollDrafts.createdAt), desc(pollDrafts.id)).limit(1);
      const poll = latest?.publishedPollId && !latest.archivedAt ? await currentGoalPoll(tx, goal.commonsId, latest.publishedPollId) : null;
      const [count] = poll ? await tx.select({ n: sql<number>`count(*)::int` }).from(pollResponses).where(eq(pollResponses.pollId, poll.id)) : [{ n: 0 }];
      // The explicit close must belong to this Goal revision. Editing/reopening
      // a Goal cannot inherit completion from an earlier closed collection.
      if (poll?.status === "closed" && !poll.archivedAt && poll.closedAt && poll.closedAt >= step.createdAt && count.n > 0) {
        await completeStep(tx, goal, step, { kind: "poll", headline: `${goal.title}: food collection finished.`, detail: `${count.n} saved responses remain available for organizer advice. No meal arrangement, allergy accommodation, booking or Plan change is confirmed.`, sources: [], unknowns: [], receipt: null, retrievedAt: poll.closedAt.toISOString() }, options);
      }
    }
    return;
  }
  if (step.kind === "research") {
    const [task] = await tx.select().from(researchTasks).where(and(eq(researchTasks.id, step.refId), eq(researchTasks.commonsId, goal.commonsId), (goal.legacyTaskId === step.refId ? undefined : eq(researchTasks.threadId, goal.threadId)))).for("update");
    if (!task) throw new CommandAccessError();
    // No legacy result can complete domain-bound work; terminal queue failures
    // still propagate through the common report path (including revoked access).
    if (step.result?.workflowExecution || step.result?.workflowExecutionPending) {
      if (task.status === "failed" || task.status === "cancelled") {
        await tx.update(coordinatorGoals).set({ lifecycle: "failed", errorCode: task.errorCode ?? task.status, updatedAt: now, completedAt: now }).where(eq(coordinatorGoals.id, goal.id));
        await report(tx, goal, "failed", `${goal.title}: research stopped without a current result.`, now);
      }
      return;
    }
    if (task.status === "succeeded" && task.result) {
      const r = task.result;
      const outcome = GoalOutcomeSchema.parse({ kind: r.sources.length ? "research" : "limited", headline: `${goal.title}: ${r.sources.length} sources${r.status !== "complete" ? ", limited coverage" : ""}.`, detail: "References only. Prices and availability are unverified.", sources: r.sources.slice(0,12).map(source => ({ title: source.title.slice(0, 160), url: source.url })), unknowns: r.limitations.slice(0,8).map(text => text.slice(0, 240)), receipt: null, retrievedAt: r.sources[0]?.retrievedAt ?? null });
      await completeStep(tx, goal, step, outcome, options);
    } else if (task.status === "needs_input") await wait(tx, goal, "waiting_for_input", "Provide the missing research detail.", now);
    else if (task.status === "failed" || task.status === "cancelled") {
      await tx.update(coordinatorGoals).set({ lifecycle: "failed", errorCode: task.errorCode ?? task.status, updatedAt: now, completedAt: now }).where(eq(coordinatorGoals.id, goal.id));
      await report(tx, goal, "failed", `${goal.title}: research stopped without a current result.`, now);
    }
  }
  if (step.params.kind === "poll") {
    const poll = await currentGoalPoll(tx, goal.commonsId, step.refId);
    if (!poll) { await wait(tx, goal, "waiting_for_input", "This poll is no longer available. Choose a current poll.", now); return; }
    const answers = await tx.select().from(pollResponses).where(eq(pollResponses.pollId, poll.id));
    if (pollStepComplete(step.params.rule, { closed: poll.status === "closed", responseCount: answers.length, invitedIds: poll.audience && !poll.audience.guestEmails.length && poll.ballotMode === "transparent" ? poll.audience.personIds : null, respondedIds: answers.flatMap(answer => answer.respondentPersonId ? [answer.respondentPersonId] : []), now: now.getTime(), manual: false })) {
      const detail = `${await pollSummary(tx,poll.id)} ${answers.length} saved responses. ${poll.audience ? "Named coverage is based only on verified participant identities." : "Link responses use self-reported names; they do not prove named traveler coverage."} Results are evidence, not approval of a plan change.`;
      await completeStep(tx, goal, step, { kind: "poll", headline: `${goal.title}: ${answers.length} responses collected.`, detail, sources: [], unknowns: [], receipt: null, retrievedAt: now.toISOString() }, options);
    }
  }
  if(step.kind === "outreach"){
    const [outreach]=await tx.select().from(coordinatorOutreach).where(and(eq(coordinatorOutreach.id,step.refId),eq(coordinatorOutreach.commonsId,goal.commonsId)));
    if(outreach?.status === "replied"){
      const [reply]=await tx.select().from(coordinatorOutreachMessages).where(and(eq(coordinatorOutreachMessages.outreachId,outreach.id),eq(coordinatorOutreachMessages.direction,"inbound"),eq(coordinatorOutreachMessages.late,false))).orderBy(asc(coordinatorOutreachMessages.occurredAt));
      if(reply)await completeStep(tx,goal,step,{kind:"participant_statement",headline:`${goal.title}: ${outreach.sendSnapshot.recipientName} answered.`,detail:`A participant replied to “${outreach.sendSnapshot.question}”. The reply is retained privately; its contents were not shared or saved as trip facts.`,sources:[{title:"Synthetic participant reply; no live delivery",url:null}],unknowns:["Self-reported statement, not a verified travel update."],receipt:null,retrievedAt:reply.occurredAt.toISOString()},options);
    }else if(outreach && (outreach.status === "opted_out" || outreach.expiresAt<=now)){
      await tx.update(coordinatorOutreach).set({status:outreach.status === "opted_out"?"opted_out":"timed_out",updatedAt:now}).where(eq(coordinatorOutreach.id,outreach.id));
      await tx.update(coordinatorGoals).set({lifecycle:"failed",errorCode:outreach.status === "opted_out"?"participant_opted_out":"participant_timeout",completedAt:now,updatedAt:now}).where(eq(coordinatorGoals.id,goal.id));
      await report(tx,goal,"failed",`${goal.title}: ${outreach.status === "opted_out"?"participant opted out":"no answer before the deadline"}.`,now);
    }
  }
  if (step.kind === "plan_action") {
    const [turn] = await tx.select().from(coordinatorTurns).where(and(eq(coordinatorTurns.id, step.refId), eq(coordinatorTurns.commonsId, goal.commonsId), eq(coordinatorTurns.threadId, goal.threadId), eq(coordinatorTurns.organizerShared, true))).for("share");
    const proposal = turn?.workspace?.tripProposal;
    if (proposal?.state === "applied" && proposal.receipt) {
      const receipt = proposal.receipt;
      await completeStep(tx, goal, step, { kind: "plan_receipt", headline: `${goal.title}: reviewed changes saved by ${receipt.appliedBy}.`, detail: `Applied operations: ${proposal.operations.join(", ")}.`, sources: [], unknowns: [], receipt: { object: receipt.planId ?? receipt.stayId ?? goal.commonsId, approvedBy: receipt.appliedBy, version: receipt.resultingVersions?.find(value => value.id === (receipt.planId ?? receipt.stayId ?? goal.commonsId))?.version ?? null, at: receipt.at }, retrievedAt: null }, options);
    } else if (!proposal || proposal.state === "dismissed") await wait(tx, goal, "waiting_for_input", "The review was dismissed or removed. Prepare a new review to continue.", now);
  }
}

async function pollSummary(tx:CommandTransaction,id:string){
  const [poll]=await tx.select().from(polls).where(eq(polls.id,id));
  if(!poll||!pollResultsAreVisible(poll.ballotMode,poll.status))return "Ballot results remain private until voting closes.";
  const answers=await tx.select().from(pollResponses).where(eq(pollResponses.pollId,id));
  return poll.questions.map(q=>q.kind==="choice"?`${q.prompt}: ${q.options.map(o=>`${o.label} ${answers.filter(r=>r.answers.some(a=>a.questionId===q.id&&a.optionIds.includes(o.id))).length}`).join(", ")}`:q.kind==="text"?`${q.prompt}: ${answers.filter(r=>r.answers.some(a=>a.questionId===q.id&&a.text)).length} text answers (open the poll to read them).`:`${q.prompt}: Grouped responses, rankings or points are not summarized in this report. Open the poll results to inspect the saved answers.`).join("; ").slice(0,800);
}

async function project(tx: CommandTransaction, goal: Goal, actor: string, options: GoalOptions): Promise<CoordinatorGoal> {
  const [owner] = await tx.select().from(people).where(eq(people.id, goal.createdByPersonId));
  const steps = await tx.select().from(coordinatorGoalSteps).where(and(eq(coordinatorGoalSteps.goalId, goal.id), eq(coordinatorGoalSteps.goalRevision, goal.revision))).orderBy(asc(coordinatorGoalSteps.seq));
  const current = steps.find(step => step.kind === "research" && step.refId);
  const pendingBinding = Boolean(current?.result?.workflowExecutionPending) && goal.lifecycle === "running";
  const [task] = current?.refId ? await tx.select().from(researchTasks).where(eq(researchTasks.id, current.refId)) : [];
  const runs = task ? await tx.select().from(coordinatorResearchRuns).where(eq(coordinatorResearchRuns.threadId,task.threadId)).orderBy(desc(coordinatorResearchRuns.createdAt)) : [];
  const [trip]=await tx.select().from(commons).where(eq(commons.id,goal.commonsId));
  const linked=goal.ideaIds.length?await tx.select().from(itineraryItems).where(and(eq(itineraryItems.commonsId,goal.commonsId),inArray(itineraryItems.id,goal.ideaIds))):[];
  const revisionStart=steps[0]?.createdAt??goal.createdAt;
  let resultStale=Boolean(goal.outcome && goal.outcome.kind !== "plan_receipt" && [trip.updatedAt,...linked.map(item=>item.updatedAt)].some(at=>at>revisionStart));
  const pollStep=steps.find(step=>step.kind === "poll" && step.refId && step.status === "done");
  if(pollStep?.refId && goal.outcome?.retrievedAt){const changed=await tx.select().from(pollResponses).where(eq(pollResponses.pollId,pollStep.refId));const poll=await currentGoalPoll(tx,goal.commonsId,pollStep.refId);if(!poll || changed.some(answer=>answer.updatedAt>new Date(goal.outcome!.retrievedAt!)) || poll.updatedAt>new Date(goal.outcome.retrievedAt))resultStale=true;}
  const history = task ? await tx.select().from(coordinatorTaskEvents).where(eq(coordinatorTaskEvents.taskId, task.id)) : [];
  const ownRunIds = new Set(history.flatMap(event => event.runId ? [event.runId] : []));
  const ownRuns = task ? runs.filter(run => run.commandId === task.commandId || run.id === taskRunId(task.id,1) || ownRunIds.has(run.id)) : [];
  const planningStep = steps.find(step => step.params.kind === "planning");
  const planning = planningStep?.params.kind === "planning" ? await planningGoalProgress(tx, goal.commonsId, planningStep.params.runId) : undefined;
  if (planning && goal.outcome?.kind === "planning_decision" && goal.outcome.receipt) {
    resultStale = goal.outcomeRevision !== goal.revision;
    try { await assertPlanningGoalOutcome(tx, goal.commonsId, planning.runId, goal.outcome.receipt.object); }
    catch (error) { if (error instanceof CommandConflictError) resultStale = true; else throw error; }
  }
  return CoordinatorGoalSchema.parse({ goalId: goal.id, threadId: goal.threadId, mainThreadId: goal.mainThreadId, kind: goal.kind, title: goal.title, goal: goal.goal, completionCriterion: goal.completionCriterion, revision: goal.revision, lifecycle: pendingBinding ? "ready" : goal.lifecycle, waitDetail: pendingBinding ? "This task is waiting for its research brief to be refreshed." : goal.waitDetail,
    ...(planning ? { planning, ...(!isGoalTerminal(goal.lifecycle) ? { waitDetail: planning.nextAction } : {}) } : {}),
    steps: steps.map(step => ({ seq: step.seq, kind: step.kind, status: pendingBinding && step.id === current?.id ? "pending" : step.status, label: step.kind === "plan_action" ? "Reviewed plan update" : step.kind, summary: null, refId: step.refId })),
    research: task ? { taskId: task.id, status: task.status, waitingForSlot: false, currentRunId: ownRuns[0]?.id ?? null, runIds: ownRuns.map(run=>run.id), resultOutdated: Boolean(goal.outcomeRevision && goal.outcomeRevision !== goal.revision) } : null,
    outcome: goal.outcome, outcomeRevision: goal.outcomeRevision, errorCode: goal.errorCode, executionBlocked: pendingBinding || goal.lifecycle === "ready" && !options.researchAvailable && goal.envelope.steps.some(step => step.kind === "research") ? "runner" : null,
    ideaIds: goal.ideaIds, ownedByMe: actor === goal.createdByPersonId, requestedByName: owner?.displayName ?? "Organizer", legacy: Boolean(goal.legacyTaskId), resultStale, sourceThreadId:goal.legacyTaskId?task?.threadId??null:null, createdAt: goal.createdAt.toISOString(), updatedAt: goal.updatedAt.toISOString(), completedAt: goal.completedAt?.toISOString() ?? null });
}

export async function operateCoordinatorGoal(identifier: string, raw: unknown, options: GoalOptions) {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(tx => operateCoordinatorGoalInTransaction(tx, identifier, raw, options)); } finally { await database.close(); }
}

/** Source lifecycle projection; never grants another organizer Goal editing authority. */
export async function syncPlanningGoalArchive(tx: CommandTransaction, tripId: string, runId: string, archived: boolean, now: Date) {
  const linked = await tx.select({ goal: coordinatorGoals, step: coordinatorGoalSteps }).from(coordinatorGoalSteps).innerJoin(coordinatorGoals, eq(coordinatorGoals.id, coordinatorGoalSteps.goalId)).where(and(eq(coordinatorGoals.commonsId, tripId), eq(coordinatorGoalSteps.kind, "planning"), eq(coordinatorGoalSteps.refId, runId)));
  for (const { goal, step } of linked) {
    if (step.goalRevision !== goal.revision) continue;
    if (archived ? isGoalTerminal(goal.lifecycle) : goal.lifecycle !== "cancelled" || goal.errorCode !== "workflow_archived") continue;
    if (!archived) {
      const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(coordinatorGoals).where(and(eq(coordinatorGoals.commonsId, tripId), eq(coordinatorGoals.createdByPersonId, goal.createdByPersonId), inArray(coordinatorGoals.lifecycle, ["ready", "running", "waiting_for_input", "waiting_for_approval", "waiting_for_event"])));
      if (count.n >= 6) throw new CommandConflictError();
    }
    await stopRuns(tx, goal, now);
    await tx.update(coordinatorGoalReports).set({ supersededAt: now }).where(eq(coordinatorGoalReports.goalId, goal.id));
    const patch = { revision: goal.revision + 1, lifecycle: archived ? "cancelled" as const : "ready" as const, errorCode: archived ? "workflow_archived" : null, waitDetail: archived ? "The private draft was deleted. Restore it from Deleted drafts to continue." : null, completedAt: archived ? now : null, updatedAt: now };
    await tx.update(coordinatorGoals).set(patch).where(eq(coordinatorGoals.id, goal.id));
    Object.assign(goal, patch);
    // Keep the current revision's reference even while archived so restore and
    // legacy links resolve this same Goal rather than manufacturing another one.
    if (archived) await tx.insert(coordinatorGoalSteps).values({ goalId: goal.id, commonsId: tripId, goalRevision: goal.revision, seq: 0, kind: "planning", params: { kind: "planning", runId }, refId: runId, status: "cancelled", createdAt: now });
    else await beginSteps(tx, goal, { actorPersonId: goal.createdByPersonId, researchAvailable: false, now });
  }
}
/** A human's same-Goal food revision resumes collection, never another Goal or Plan. */
export async function resumeFoodCollectionGoal(tx: CommandTransaction, tripId: string, runId: string, now: Date) {
  const linked = await tx.select({ goal: coordinatorGoals, step: coordinatorGoalSteps }).from(coordinatorGoalSteps).innerJoin(coordinatorGoals, eq(coordinatorGoals.id, coordinatorGoalSteps.goalId))
    .where(and(eq(coordinatorGoals.commonsId, tripId), eq(coordinatorGoalSteps.kind, "planning"), eq(coordinatorGoalSteps.refId, runId))).for("update", { of: coordinatorGoals });
  for (const { goal, step } of linked) {
    if (step.goalRevision !== goal.revision || goal.lifecycle !== "completed" || goal.outcome?.kind !== "poll") continue;
    const [owner] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, tripId), eq(memberships.personId, goal.createdByPersonId), eq(memberships.role, "organizer"), eq(memberships.status, "active")));
    if (!owner) continue;
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(coordinatorGoals).where(and(eq(coordinatorGoals.commonsId, tripId), eq(coordinatorGoals.createdByPersonId, goal.createdByPersonId), inArray(coordinatorGoals.lifecycle, ["ready", "running", "waiting_for_input", "waiting_for_approval", "waiting_for_event"])));
    if (count.n >= 6) throw new CommandConflictError();
    await tx.update(coordinatorGoalReports).set({ supersededAt: now }).where(and(eq(coordinatorGoalReports.goalId, goal.id), eq(coordinatorGoalReports.goalRevision, goal.revision)));
    const patch = { revision: goal.revision + 1, lifecycle: "ready" as const, outcome: null, outcomeRevision: null, completedAt: null, errorCode: null, updatedAt: now };
    await tx.update(coordinatorGoals).set(patch).where(eq(coordinatorGoals.id, goal.id)); Object.assign(goal, patch);
    await beginSteps(tx, goal, { actorPersonId: goal.createdByPersonId, researchAvailable: false, now });
  }
}

export async function operateCoordinatorGoalInTransaction(tx: CommandTransaction, identifier: string, raw: unknown, options: GoalOptions) {
  const input = GoalOperationRequestSchema.parse(raw), now = nowOf(options);
    const trip = await requireTripOrganizer(tx, identifier, options.actorPersonId);
    await assertCoordinatorTurnFenceInTransaction(tx, trip, options.actorPersonId, options.turnFence);
    const fingerprint = commandFingerprint(options.actorPersonId, "goal-operation", input);
    const [replay] = await tx.select().from(coordinatorGoalEvents).where(and(eq(coordinatorGoalEvents.commonsId, trip), eq(coordinatorGoalEvents.commandId, input.commandId)));
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new CommandConflictError();
      const [previous] = await tx.select().from(coordinatorGoals).where(whereGoal(replay.goalId, trip));
      if (!previous) throw new CommandAccessError();
      return { goal: await project(tx, previous, options.actorPersonId, options), replayed: true };
    }
    let goal: Goal;
    if (input.op === "start") {
      if (input.kind === "participant" && !options.syntheticParticipants) throw new CommandAccessError();
      const envelope = goalEnvelope(input), key = input.kind === "planning"
        ? commandFingerprint("", "planning-goal", { trip, runId: input.workflowRunId }) : options.reviewedWorkflowKey
        ? commandFingerprint(options.actorPersonId, "reviewed-workflow-goal-key", { goalKey: keyOf(input), reviewed: options.reviewedWorkflowKey }) : keyOf(input);
      if (input.kind === "planning") {
        const [run] = await tx.select().from(recipeRuns).where(and(eq(recipeRuns.id, input.workflowRunId!), eq(recipeRuns.commonsId, trip)));
        if (!run || run.status !== "active" || run.createdByPersonId !== options.actorPersonId) throw new CommandAccessError();
      }
      const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(coordinatorGoals).where(and(eq(coordinatorGoals.commonsId, trip), eq(coordinatorGoals.createdByPersonId, options.actorPersonId), inArray(coordinatorGoals.lifecycle, ["ready", "running", "waiting_for_input", "waiting_for_approval", "waiting_for_event"])));
      const [existing] = await tx.select().from(coordinatorGoals).where(and(eq(coordinatorGoals.commonsId, trip), eq(coordinatorGoals.goalKey, key), input.kind === "planning" ? undefined : inArray(coordinatorGoals.lifecycle, ["ready", "running", "waiting_for_input", "waiting_for_approval", "waiting_for_event"])));
      if (existing) {
        await tx.insert(coordinatorGoalEvents).values({ goalId: existing.id, commonsId: trip, goalRevision: existing.revision, kind: "start_existing", actorPersonId: options.actorPersonId, commandId: input.commandId, fingerprint, createdAt: now });
        return { goal: await project(tx, existing, options.actorPersonId, options), replayed: true };
      }
      if (count.n >= 6) throw new CommandConflictError();
      const [event] = await tx.select().from(commons).where(eq(commons.id, trip));
      if (event.status === "archived" || event.status === "closing") throw new CommandAccessError();
      if (input.ideaIds.length) {
        const ideas = await tx.select().from(itineraryItems).where(and(eq(itineraryItems.commonsId, trip), inArray(itineraryItems.id, input.ideaIds)));
        if (ideas.length !== new Set(input.ideaIds).size || ideas.some(idea => idea.status === "cancelled")) throw new CommandAccessError();
        if (input.ideaVersions.some(ref => !ideas.some(idea => idea.id === ref.id && idea.updatedAt.toISOString() === ref.version))) throw new CommandConflictError();
      }
      if (input.recipientPersonId) {
        const [recipient] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, trip), eq(memberships.personId, input.recipientPersonId), eq(memberships.status, "active"))).for("share");
        if (!recipient) throw new CommandAccessError();
      }
      const main = await ensureMainThreadInTransaction(tx, trip, options.actorPersonId, now), threadId = randomUUID();
      await tx.insert(coordinatorThreads).values({ id: threadId, commonsId: trip, createdByPersonId: options.actorPersonId, title: input.title, lastCommandId: input.commandId, lastCommandFingerprint: fingerprint, createdAt: now, updatedAt: now });
      await tx.insert(coordinatorThreadLinks).values({ threadId, commonsId: trip, kind: "task", parentThreadId: main.id, brief: input.goal });
      [goal] = await tx.insert(coordinatorGoals).values({ commonsId: trip, kind: input.kind, mainThreadId: main.id, threadId, createdByPersonId: options.actorPersonId, title: input.title, goal: input.goal, completionCriterion: input.completionCriterion || goalFinishLine[input.kind], envelope, goalKey: key, ideaIds: input.ideaIds, commandId: input.commandId, fingerprint, createdAt: now, updatedAt: now }).returning();
      await beginSteps(tx, goal, options);
    } else {
      const [found] = await tx.select().from(coordinatorGoals).where(whereGoal(input.goalId, trip)).for("update");
      if (!found || found.createdByPersonId !== options.actorPersonId) throw new CommandAccessError();
      goal = found;
      if (goal.errorCode === "workflow_archived") throw new CommandConflictError();
      const planning = goal.envelope.steps.find(step => step.kind === "planning");
      if (planning?.kind === "planning") {
        const [source] = await tx.select().from(recipeRuns).where(and(eq(recipeRuns.id, planning.runId), eq(recipeRuns.commonsId, trip)));
        if (!source || source.status !== "active") throw new CommandConflictError();
      }
      if ("expectedRevision" in input && input.expectedRevision !== goal.revision) throw new GoalRevisionConflict(goal.revision);
      if (input.op !== "reopen" && isGoalTerminal(goal.lifecycle)) throw new CommandConflictError();
      if (input.op === "cancel") {
        await stopRuns(tx, goal, now);
        await tx.update(coordinatorGoals).set({ lifecycle: "cancelled", completedAt: now, updatedAt: now }).where(eq(coordinatorGoals.id, goal.id));
      } else if (input.op === "amend" || input.op === "answer" || input.op === "reopen" || input.op === "edit_goal") {
        if (input.op === "reopen" && !isGoalTerminal(goal.lifecycle)) throw new CommandConflictError();
        await stopRuns(tx, goal, now);
        const revision = goal.revision + 1;
        const envelope: GoalEnvelope = { ...goal.envelope, steps: goal.envelope.steps.map(step => step.kind === "research" && "query" in input && input.query ? { ...step, query: input.query } : step.kind === "poll" ? { ...step, pollId: null } : step.kind === "plan_action" ? { ...step, turnId: null } : step) };
        const text = input.op === "answer" ? input.answer : input.op === "edit_goal" ? input.goal : input.note;
        const brief = input.op === "edit_goal" ? input.goal : `${goal.goal}\n${text}`;
        const completionCriterion = input.op === "edit_goal" ? input.completionCriterion : goal.completionCriterion;
        if (brief.length > 2000) throw new CommandConflictError();
        await tx.update(coordinatorGoals).set({ revision, goal: brief, completionCriterion, envelope, lifecycle: "ready", waitDetail: null, errorCode: null, completedAt: null, updatedAt: now }).where(eq(coordinatorGoals.id, goal.id));
        await tx.update(coordinatorGoalReports).set({ supersededAt: now }).where(and(eq(coordinatorGoalReports.goalId, goal.id), eq(coordinatorGoalReports.goalRevision, goal.revision)));
        await tx.update(coordinatorThreadLinks).set({ brief: brief.slice(0, 1000) }).where(eq(coordinatorThreadLinks.threadId, goal.threadId));
        Object.assign(goal, { revision, goal: brief, completionCriterion, envelope, lifecycle: "ready", waitDetail: null, completedAt: null });
        if (input.op === "edit_goal" && goal.kind !== "planning" || input.op === "amend" && input.missingFact) {
          for (const [seq, params] of envelope.steps.entries()) await tx.insert(coordinatorGoalSteps).values({ goalId: goal.id, commonsId: trip, goalRevision: revision, seq, kind: params.kind, params, createdAt: now });
          await wait(tx, goal, "waiting_for_input", input.op === "edit_goal" ? "Goal changed. Review the next step before continuing; earlier results remain history." : input.missingFact!, now);
        } else await beginSteps(tx, goal, options);
      } else {
        const [step] = await tx.select().from(coordinatorGoalSteps).where(and(eq(coordinatorGoalSteps.goalId, goal.id), eq(coordinatorGoalSteps.goalRevision, goal.revision), eq(coordinatorGoalSteps.status, "waiting"))).orderBy(asc(coordinatorGoalSteps.seq));
        if (!step) throw new CommandConflictError();
        if (input.op === "accept_outcome") {
          if (step.params.kind !== "planning") throw new CommandConflictError();
          const [run] = await tx.select().from(recipeRuns).where(and(eq(recipeRuns.id, step.params.runId), eq(recipeRuns.commonsId, trip)));
          const [outcome] = await tx.select().from(recipeOutcomes).where(and(eq(recipeOutcomes.id, input.outcomeId), eq(recipeOutcomes.runId, step.params.runId))).for("share");
          if (!run || run.status !== "active" || !outcome || outcome.status === "superseded" || !await currentGoalPoll(tx, trip, outcome.pollId)) throw new CommandConflictError();
          await assertPlanningGoalOutcome(tx, trip, run.id, outcome.id);
          await completeStep(tx, goal, step, { kind: "planning_decision", headline: `${goal.title}: outcome reviewed against this goal.`, detail: "The goal owner accepted the saved outcome. This does not apply a new change to the Plan.", sources: [], unknowns: [], receipt: { object: outcome.id, approvedBy: (await tx.select().from(people).where(eq(people.id, options.actorPersonId)))[0].displayName, version: String(goal.revision), at: now.toISOString() }, retrievedAt: null }, options);
        } else if (input.op === "link_poll") {
          if (step.kind !== "poll") throw new CommandConflictError();
          const poll = await currentGoalPoll(tx, trip, input.pollId);
          if (!poll || (input.rule.mode === "all_invited" && (!poll.audience || poll.audience.guestEmails.length || poll.ballotMode === "secret"))) throw new CommandConflictError();
          await tx.update(coordinatorGoalSteps).set({ refId: poll.id, params: { kind: "poll", pollId: poll.id, rule: input.rule } }).where(eq(coordinatorGoalSteps.id, step.id));
          await wait(tx, goal, "waiting_for_event", "Waiting for poll responses; no model runs while waiting.", now);
        } else if (input.op === "link_proposal") {
          if (step.kind !== "plan_action") throw new CommandConflictError();
          const [turn] = await tx.select().from(coordinatorTurns).where(and(eq(coordinatorTurns.id, input.turnId), eq(coordinatorTurns.commonsId, trip), eq(coordinatorTurns.threadId, goal.threadId), eq(coordinatorTurns.organizerShared, true)));
          if (!turn?.workspace?.tripProposal || turn.workspace.tripProposal.state === "dismissed") throw new CommandAccessError();
          await tx.update(coordinatorGoalSteps).set({ refId: turn.id, params: { kind: "plan_action", turnId: turn.id } }).where(eq(coordinatorGoalSteps.id, step.id));
        } else if (input.op === "finish_collection") {
          if (step.kind !== "poll" || !step.refId) throw new CommandConflictError();
          if (!await currentGoalPoll(tx, trip, step.refId)) throw new CommandConflictError();
          const answers = await tx.select().from(pollResponses).where(eq(pollResponses.pollId, step.refId));
          await completeStep(tx, goal, step, { kind: "poll", headline: `${goal.title}: collection finished with ${answers.length} responses.`, detail: `${await pollSummary(tx,step.refId)} Collection finished by the task owner. The poll and shared plan were not changed.`, sources: [], unknowns: [], receipt: null, retrievedAt: now.toISOString() }, options);
        }
      }
    }
    await tx.insert(coordinatorGoalEvents).values({ goalId: goal.id, commonsId: trip, goalRevision: goal.revision, kind: input.op, actorPersonId: options.actorPersonId, commandId: input.commandId, fingerprint, summary: input.op === "answer" ? input.answer : "note" in input ? input.note : null, createdAt: now });
    const [saved] = await tx.select().from(coordinatorGoals).where(eq(coordinatorGoals.id, goal.id));
    await reconcile(tx, saved, options);
    const [current] = await tx.select().from(coordinatorGoals).where(eq(coordinatorGoals.id, goal.id));
    return { goal: await project(tx, current, options.actorPersonId, options), replayed: false };

}

/** Additive compatibility projection. Original execution/history never moves; no run or shared private-history report is created. */
export async function backfillCoordinatorGoals(tx:CommandTransaction,trip:string,actor:string,now:Date){
  const legacy=await tx.select({task:researchTasks,state:coordinatorTaskState}).from(researchTasks).innerJoin(coordinatorThreads,and(eq(coordinatorThreads.id,researchTasks.threadId),eq(coordinatorThreads.commonsId,researchTasks.commonsId))).leftJoin(coordinatorTaskState,eq(coordinatorTaskState.taskId,researchTasks.id)).where(eq(researchTasks.commonsId,trip));
  for(const {task,state} of legacy){
    const [mapped]=await tx.select({id:coordinatorGoals.id}).from(coordinatorGoals).where(eq(coordinatorGoals.legacyTaskId,task.id));
    const [stepRef]=await tx.select({id:coordinatorGoalSteps.id}).from(coordinatorGoalSteps).where(eq(coordinatorGoalSteps.refId,task.id));
    if(mapped||stepRef)continue;
    const [owner]=await tx.select().from(memberships).where(and(eq(memberships.commonsId,trip),eq(memberships.personId,task.requestedByPersonId),eq(memberships.role,"organizer"),eq(memberships.status,"active")));
    if(!owner)continue;
    const main=await ensureMainThreadInTransaction(tx,trip,actor,now),threadId=randomUUID(),commandId=randomUUID();
    const title=(state?.title||task.request.input.query).slice(0,120),brief=(state?.brief||task.request.input.query).slice(0,1000),revision=state?.revision??1;
    await tx.insert(coordinatorThreads).values({id:threadId,commonsId:trip,createdByPersonId:task.requestedByPersonId,title,lastCommandId:commandId,lastCommandFingerprint:"legacy-goal-map",createdAt:task.createdAt,updatedAt:task.updatedAt});
    await tx.insert(coordinatorThreadLinks).values({threadId,commonsId:trip,kind:"task",parentThreadId:main.id,brief:`Earlier research task. ${brief}`.slice(0,1000),briefTaskIds:[task.id]});
    const envelope=goalEnvelope({op:"start",commandId,kind:"research",title,goal:brief,query:task.request.input.query,completionCriterion:"",ideaIds:[],ideaVersions:[],then:[]});
    const lifecycle:Goal["lifecycle"]=task.status==="succeeded"?"completed":task.status==="failed"?"failed":task.status==="cancelled"?"cancelled":task.status==="needs_input"?"waiting_for_input":"running";
    const outcome:GoalOutcome|null=task.result?{kind:task.result.sources.length?"research":"limited",headline:`${title}: earlier research result.`,detail:"Original sourced research is preserved in its earlier conversation. Availability and prices are unverified.",sources:task.result.sources.slice(0,12).map(v=>({title:v.title.slice(0,160),url:v.url})),unknowns:task.result.limitations.slice(0,8).map(v=>v.slice(0,240)),receipt:null,retrievedAt:task.result.sources[0]?.retrievedAt??null}:null;
    const [goal]=await tx.insert(coordinatorGoals).values({commonsId:trip,mainThreadId:main.id,threadId,createdByPersonId:task.requestedByPersonId,kind:"research",title,goal:brief,completionCriterion:goalFinishLine.research,revision,envelope,goalKey:`legacy:${task.id}`,legacyTaskId:task.id,lifecycle,outcome,outcomeRevision:outcome?(state?.resultRevision??revision):null,waitDetail:state?.needsInput??null,commandId,fingerprint:"legacy-goal-map",createdAt:task.createdAt,updatedAt:task.updatedAt,completedAt:isGoalTerminal(lifecycle)?task.updatedAt:null}).returning();
    await tx.insert(coordinatorGoalSteps).values({goalId:goal.id,commonsId:trip,goalRevision:revision,seq:0,kind:"research",params:envelope.steps[0],refId:task.id,status:task.status==="succeeded"?"done":task.status==="failed"?"failed":task.status==="cancelled"?"cancelled":task.status==="needs_input"?"waiting":"running",createdAt:now});
  }
}

export async function listCoordinatorGoals(identifier: string, options: GoalOptions) {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const trip = await requireTripOrganizer(tx, identifier, options.actorPersonId);
    await backfillCoordinatorGoals(tx,trip,options.actorPersonId,nowOf(options));
    const rows = await tx.select().from(coordinatorGoals).where(eq(coordinatorGoals.commonsId, trip)).orderBy(desc(coordinatorGoals.updatedAt)).limit(100);
    for (const goal of rows) {
      const [owner] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, trip), eq(memberships.personId, goal.createdByPersonId), eq(memberships.role, "organizer"), eq(memberships.status, "active"))).for("share");
      if (owner) await reconcile(tx, goal, options);
      else if (!isGoalTerminal(goal.lifecycle)) { await stopRuns(tx, goal, nowOf(options)); await tx.update(coordinatorGoals).set({ lifecycle: "failed", errorCode: "access_revoked", updatedAt: nowOf(options) }).where(eq(coordinatorGoals.id, goal.id)); }
    }
    const refreshed = await tx.select().from(coordinatorGoals).where(eq(coordinatorGoals.commonsId, trip)).orderBy(desc(coordinatorGoals.updatedAt)).limit(100);
    const goals = await Promise.all(refreshed.map(goal => project(tx, goal, options.actorPersonId, options)));
    const reports = await tx.select({ report: coordinatorGoalReports, goal: coordinatorGoals }).from(coordinatorGoalReports).innerJoin(coordinatorGoals, eq(coordinatorGoals.id, coordinatorGoalReports.goalId)).where(eq(coordinatorGoalReports.commonsId, trip)).orderBy(desc(coordinatorGoalReports.createdAt)).limit(50);
    const projected = new Map(goals.map(goal => [goal.goalId, goal]));
    // The report window can include an older goal outside the navigation window.
    // Check its source state too; a historical report must not become current
    // evidence merely because its task is absent from the first hundred rows.
    for (const { goal } of reports) if (!projected.has(goal.id)) projected.set(goal.id, await project(tx, goal, options.actorPersonId, options));
    return { goals, reports: reports.map(({ report: r, goal: g }): GoalReport => ({ id: r.id, goalId: g.id, goalTitle: g.title, threadId: g.threadId, goalRevision: r.goalRevision, kind: r.kind, headline: r.headline, detail: r.detail, nextAction: r.nextAction, sources: r.sources, superseded: Boolean(r.supersededAt) || r.goalRevision !== g.revision || ((r.kind === "completed" || r.kind === "milestone") && Boolean(projected.get(g.id)?.resultStale)) || (r.kind === "needs_input" && g.lifecycle !== "waiting_for_input") || (r.kind === "needs_approval" && g.lifecycle !== "waiting_for_approval"), createdAt: r.createdAt.toISOString() })) };
  }); } finally { await database.close(); }
}


/** Transactional research result/report projection. Safe on pre-goal schemas during rollback. */
export async function projectResearchGoalInTransaction(tx: CommandTransaction, taskId: string, now: Date) {
  const [schema] = await tx.execute<{ present: boolean }>(sql`select to_regclass('public.coordinator_goals') is not null as present`);
  if (!schema?.present) return;
  const linked = await tx.select({ goal: coordinatorGoals, step: coordinatorGoalSteps }).from(coordinatorGoalSteps).innerJoin(coordinatorGoals, eq(coordinatorGoals.id, coordinatorGoalSteps.goalId)).where(and(eq(coordinatorGoalSteps.refId, taskId), eq(coordinatorGoalSteps.kind, "research")));
  for (const { goal, step } of linked) {
    if (step.goalRevision !== goal.revision || isGoalTerminal(goal.lifecycle)) continue;
    await reconcile(tx, goal, { actorPersonId: goal.createdByPersonId, researchAvailable: false, now });
  }
}

/** Shared report/completion path for a fenced generic worker. Caller holds trip,
 * task and current execution locks and has rechecked authorization and pins.
 */
export async function projectWorkflowGoalInTransaction(tx: CommandTransaction, stepId: string, result: { question: string } | { outcome: GoalOutcome } | { errorCode: string }, now: Date) {
  const [step] = await tx.select().from(coordinatorGoalSteps).where(eq(coordinatorGoalSteps.id, stepId)).for("update");
  const [goal] = step ? await tx.select().from(coordinatorGoals).where(eq(coordinatorGoals.id, step.goalId)).for("update") : [];
  if (!step || !goal || step.goalRevision !== goal.revision || isGoalTerminal(goal.lifecycle) || !step.result?.workflowExecution) throw new CommandConflictError();
  if ("outcome" in result) {
    const outcome = GoalOutcomeSchema.parse(result.outcome);
    if (!["research", "limited"].includes(outcome.kind) || outcome.receipt) throw new CommandConflictError();
    await completeStep(tx, goal, step, outcome, { actorPersonId: goal.createdByPersonId, researchAvailable: false, now });
  } else if ("question" in result) {
    await tx.update(coordinatorGoalSteps).set({ status: "waiting" }).where(eq(coordinatorGoalSteps.id, step.id));
    await wait(tx, goal, "waiting_for_input", result.question.slice(0, 400), now);
  } else {
    await tx.update(coordinatorGoalSteps).set({ status: "failed", finishedAt: now }).where(eq(coordinatorGoalSteps.id, step.id));
    await tx.update(coordinatorGoals).set({ lifecycle: "failed", errorCode: result.errorCode, completedAt: now, updatedAt: now }).where(eq(coordinatorGoals.id, goal.id));
    await report(tx, goal, "failed", `${goal.title}: workflow stopped without a current result.`, now);
  }
}

/** Transactional event projection. The caller already holds the trip lock. Safe while feature code rolls back. */
export async function projectGoalEventInTransaction(tx:CommandTransaction,tripId:string,refId:string,now=new Date()){
  const [present]=await tx.execute<{present:boolean}>(sql`select to_regclass('public.coordinator_goals') is not null as present`);if(!present?.present)return;
  const rows=await tx.select({goal:coordinatorGoals,step:coordinatorGoalSteps}).from(coordinatorGoalSteps).innerJoin(coordinatorGoals,eq(coordinatorGoals.id,coordinatorGoalSteps.goalId)).where(and(eq(coordinatorGoalSteps.commonsId,tripId),eq(coordinatorGoalSteps.refId,refId)));
  for(const {goal,step} of rows){if(step.goalRevision!==goal.revision||isGoalTerminal(goal.lifecycle))continue;const [member]=await tx.select().from(memberships).where(and(eq(memberships.commonsId,tripId),eq(memberships.personId,goal.createdByPersonId),eq(memberships.role,"organizer"),eq(memberships.status,"active")));if(member)await reconcile(tx,goal,{actorPersonId:goal.createdByPersonId,researchAvailable:false,now});}
}
export async function tickCoordinatorGoals(options:{databaseUrl?:string;now?:Date}){
  const database=createDatabase(options.databaseUrl);try{const trips=await database.db.selectDistinct({tripId:coordinatorGoals.commonsId}).from(coordinatorGoals).where(inArray(coordinatorGoals.lifecycle,["running","waiting_for_input","waiting_for_approval","waiting_for_event"]));for(const {tripId} of trips)await database.db.transaction(async tx=>{await tx.select().from(commons).where(eq(commons.id,tripId)).for("update");const goals=await tx.select().from(coordinatorGoals).where(eq(coordinatorGoals.commonsId,tripId));for(const goal of goals){if(isGoalTerminal(goal.lifecycle))continue;const [member]=await tx.select().from(memberships).where(and(eq(memberships.commonsId,tripId),eq(memberships.personId,goal.createdByPersonId),eq(memberships.status,"active"),eq(memberships.role,"organizer")));if(member){await advance(tx,goal,{actorPersonId:goal.createdByPersonId,researchAvailable:false,now:options.now});await reconcile(tx,goal,{actorPersonId:goal.createdByPersonId,researchAvailable:false,now:options.now});}else{await stopRuns(tx,goal,options.now??new Date());await tx.update(coordinatorGoals).set({lifecycle:"failed",errorCode:"access_revoked",updatedAt:options.now??new Date()}).where(eq(coordinatorGoals.id,goal.id));}}});}finally{await database.close();}}

/** Linked reviews are scoped to the live goal revision. Cancellation or amendment removes their authority to satisfy that goal. */
export async function assertGoalProposalCurrent(tx:CommandTransaction,tripId:string,turnId:string){
  const [present]=await tx.execute<{present:boolean}>(sql`select to_regclass('public.coordinator_goals') is not null as present`);if(!present?.present)return;
  const linked=await tx.select({goal:coordinatorGoals,step:coordinatorGoalSteps}).from(coordinatorGoalSteps).innerJoin(coordinatorGoals,eq(coordinatorGoals.id,coordinatorGoalSteps.goalId)).where(and(eq(coordinatorGoalSteps.commonsId,tripId),eq(coordinatorGoalSteps.kind,"plan_action"),eq(coordinatorGoalSteps.refId,turnId)));
  if(linked.some(({goal,step})=>step.goalRevision !== goal.revision || isGoalTerminal(goal.lifecycle)))throw new CommandConflictError();
}
