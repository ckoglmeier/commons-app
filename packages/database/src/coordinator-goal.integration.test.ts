import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "./client";
import { operateCoordinatorGoal, listCoordinatorGoals, tickCoordinatorGoals } from "./coordinator-goal-repository";
import { claimResearchTask, finishResearchTaskDetailed } from "./research-task-repository";
import { commons, coordinatorGoalReports, coordinatorGoals, coordinatorThreads, coordinatorGoalSteps, itineraryItems, memberships, people, polls, pollResponses, researchTasks } from "./schema";
import { createCoordinatorThread, commitCoordinatorTurn, getCoordinatorThread, actOnCoordinatorWorkspace } from "./coordinator-repository";
import { startCoordinatorTask, listCoordinatorTasks, cancelCoordinatorTask } from "./coordinator-task-repository";
import { submitPublicPollResponseByPublicId, deleteCommonsPollResponse, createCommonsPoll, revokePollRecipient } from "./poll-repository";
import { saveCommonsPollDraft, reopenCoordinatorDraft } from "./poll-draft-repository";
import { commandFingerprint } from "./event-command";
import { recordResearchWorkerHeartbeat, researchWorkerHealthy } from "./coordinator-worker-health";
const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
const databaseUrl = process.env.TEST_DATABASE_URL;
async function scenario(fn: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const f = await fixture(); try { await fn(f); } finally { await f.db.db.delete(commons).where(eq(commons.id, f.trip)); await f.db.db.delete(people).where(eq(people.id, f.owner)); await f.db.db.delete(people).where(eq(people.id, f.other)); await f.db.db.delete(people).where(eq(people.id, f.traveler)); await f.db.close(); }
}
async function fixture() {
  assert.ok(databaseUrl && new URL(databaseUrl).hostname === "127.0.0.1");
  const db = createDatabase(databaseUrl), trip = randomUUID(), owner = randomUUID(), other = randomUUID(), traveler = randomUUID();
  await db.db.insert(people).values([{ id: owner, displayName: "Casey Synthetic" }, { id: other, displayName: "Robin Synthetic" }, { id: traveler, displayName: "Taylor Synthetic" }]);
  await db.db.insert(commons).values({ id: trip, slug: `goals-${trip}`, name: "Synthetic goal trip", timezone: "America/Denver", createdByPersonId: owner });
  await db.db.insert(memberships).values([{ commonsId: trip, personId: owner, role: "organizer", status: "active" }, { commonsId: trip, personId: other, role: "organizer", status: "active" }, { commonsId: trip, personId: traveler, role: "member", status: "active" }]);
  const as = (actorPersonId = owner, researchAvailable = true) => ({ databaseUrl, actorPersonId, researchAvailable });
  const start = (over: Record<string, unknown> = {}) => operateCoordinatorGoal(trip, { op: "start", commandId: randomUUID(), kind: "research", title: "Airport transfers", goal: "Compare airport transfer references for seven", query: "Airport transfer options for 7 near Sonoma", ...over }, as());
  const op = (input: Record<string, unknown>, actorPersonId = owner) => operateCoordinatorGoal(trip, { commandId: randomUUID(), ...input }, as(actorPersonId));
  return { db, trip, owner, other, traveler, as, start, op };
}

test("goals: concurrent start, duplicate goal, same command replay and starter-only mutations", { skip }, () => scenario(async f => {
  const input = { op: "start", commandId: randomUUID(), kind: "research", title: "Airport transfers", goal: "Compare transfers", query: "Public transfer options" };
  const [a, b] = await Promise.all([operateCoordinatorGoal(f.trip, input, f.as()), operateCoordinatorGoal(f.trip, input, f.as())]);
  assert.equal(a.goal.goalId, b.goal.goalId); assert.equal(a.goal.threadId, b.goal.threadId);
  await assert.rejects(operateCoordinatorGoal(f.trip, { ...input, goal: "Different" }, f.as()));
  const same = await operateCoordinatorGoal(f.trip, { ...input, commandId: randomUUID() }, f.as()); assert.equal(same.goal.goalId, a.goal.goalId);
  const shared = await listCoordinatorGoals(f.trip, f.as(f.other)); assert.equal(shared.goals[0].ownedByMe, false);
  await assert.rejects(f.op({ op: "amend", goalId: a.goal.goalId, expectedRevision: 1, note: "Cheaper" }, f.other));
  await assert.rejects(listCoordinatorGoals(f.trip, f.as(f.traveler)));
  assert.equal((await f.db.db.select().from(researchTasks).where(eq(researchTasks.commonsId, f.trip))).length, 1);
}));

test("goals: cancelling or revising work fences a late research result, and reopen preserves history", { skip }, () => scenario(async f => {
  const a = await f.start(); const lease = await claimResearchTask(databaseUrl); assert.ok(lease);
  await f.op({ op: "amend", goalId: a.goal.goalId, expectedRevision: 1, note: "Two arrive later", query: "Later airport transfer options" });
  assert.equal((await finishResearchTaskDetailed(lease, { result: { query: lease.query, sources: [], status: "partial", limitations: ["Synthetic stale result"] } }, databaseUrl)).committed, false);
  await assert.rejects(f.op({ op: "cancel", goalId: a.goal.goalId, expectedRevision: 1 }));
  const cancelled = await f.op({ op: "cancel", goalId: a.goal.goalId, expectedRevision: 2 }); assert.equal(cancelled.goal.lifecycle, "cancelled");
  const reopened = await f.op({ op: "reopen", goalId: a.goal.goalId, expectedRevision: 2, note: "Restart with current details" }); assert.equal(reopened.goal.revision, 3);
  const next = await claimResearchTask(databaseUrl); assert.ok(next);
  await f.op({ op: "cancel", goalId: a.goal.goalId, expectedRevision: 3 });
  assert.equal((await finishResearchTaskDetailed(next, { result: { query: next.query, sources: [], status: "partial", limitations: [] } }, databaseUrl)).committed, false);
}));

test("goals: research completion reports once; broader goal waits for approval instead of declaring success", { skip }, () => scenario(async f => {
  const a = await f.start({ then: ["plan_action"] }), lease = await claimResearchTask(databaseUrl); assert.ok(lease);
  assert.equal((await finishResearchTaskDetailed(lease, { result: { query: lease.query, sources: [], status: "partial", limitations: ["No verified live inventory"] } }, databaseUrl)).committed, true);
  const first = await listCoordinatorGoals(f.trip, f.as()); assert.equal(first.goals[0].lifecycle, "waiting_for_approval"); assert.equal(first.goals[0].outcome?.kind, "limited");
  const second = await listCoordinatorGoals(f.trip, f.as()); assert.equal(second.reports.length, first.reports.length); assert.equal(second.reports.filter(r => r.kind === "completed").length, 0);
  await f.op({ op: "cancel", goalId: a.goal.goalId, expectedRevision: 1 });
  assert.ok((await listCoordinatorGoals(f.trip, f.as())).reports.every(r => r.superseded), "cancelled work cannot leave a current approval request in main");
}));

test("goals: runner absence records planned work without queueing or claiming execution", { skip }, () => scenario(async f => {
  const goal = await operateCoordinatorGoal(f.trip, { op: "start", commandId: randomUUID(), kind: "research", title: "Transfers", goal: "Compare public references", query: "Transfer options" }, f.as(f.owner, false));
  assert.equal(goal.goal.lifecycle, "ready"); assert.equal(goal.goal.executionBlocked, "runner");
  assert.equal((await f.db.db.select().from(researchTasks).where(eq(researchTasks.commonsId, f.trip))).length, 0);
}));

test("goals: replacing the objective pauses execution, fences stale work and preserves identity", { skip }, () => scenario(async f => {
  const started = await f.start();
  const lease = await claimResearchTask(databaseUrl); assert.ok(lease);
  const input = { op: "edit_goal", commandId: randomUUID(), goalId: started.goal.goalId, expectedRevision: 1,
    goal: "Find a strong date and location fit for everyone", completionCriterion: "Organizer reviews constraints and approves a fit" };
  await assert.rejects(operateCoordinatorGoal(f.trip, input, f.as(f.other)));
  const edited = await operateCoordinatorGoal(f.trip, input, f.as());
  assert.equal(edited.goal.goalId, started.goal.goalId);
  assert.equal(edited.goal.threadId, started.goal.threadId);
  assert.equal(edited.goal.goal, input.goal);
  assert.equal(edited.goal.completionCriterion, input.completionCriterion);
  assert.equal(edited.goal.revision, 2);
  assert.equal(edited.goal.lifecycle, "waiting_for_input");
  assert.equal(edited.goal.steps[0].refId, null);
  assert.equal(edited.goal.outcome, null);
  assert.equal((await operateCoordinatorGoal(f.trip, input, f.as())).replayed, true);
  await assert.rejects(operateCoordinatorGoal(f.trip, { ...input, commandId: randomUUID() }, f.as()));
  assert.equal((await finishResearchTaskDetailed(lease, { result: { query: lease.query, sources: [], status: "partial", limitations: [] } }, databaseUrl)).committed, false);
  const saved = await listCoordinatorGoals(f.trip, f.as());
  assert.equal(saved.goals[0].lifecycle, "waiting_for_input");
  assert.equal((await f.db.db.select().from(researchTasks).where(eq(researchTasks.commonsId, f.trip))).length, 1, "editing must not queue another provider call");
}));

test("goals: anonymous poll counts do not become named coverage; waiting is event driven and completion deduplicates", { skip }, () => scenario(async f => {
  const a = await f.start({ kind: "poll", title: "Collect arrival preferences", goal: "Collect two responses" });
  assert.equal(a.goal.lifecycle, "waiting_for_input");
  const [poll] = await f.db.db.insert(polls).values({ commonsId: f.trip, createdByPersonId: f.owner, title: "Synthetic link poll", commandId: randomUUID(), questions: [], ballotMode: "transparent", shareTokenHash: randomUUID(), shareTokenValue: randomUUID() }).returning();
  await assert.rejects(f.op({ op: "link_poll", goalId: a.goal.goalId, expectedRevision: 1, pollId: poll.id, rule: { mode: "all_invited" } }));
  const linked = await f.op({ op: "link_poll", goalId: a.goal.goalId, expectedRevision: 1, pollId: poll.id, rule: { mode: "count", count: 2 } }); assert.equal(linked.goal.lifecycle, "waiting_for_event");
  assert.ok((await listCoordinatorGoals(f.trip, f.as())).reports.filter(r => r.kind === "needs_input").every(r => r.superseded), "linking the poll retires its earlier request for input");
  await f.db.db.insert(pollResponses).values([{ pollId: poll.id, respondentName: "Self reported A", receiptTokenHash: randomUUID(), answers: [] }, { pollId: poll.id, respondentName: "Self reported B", receiptTokenHash: randomUUID(), answers: [] }]);
  const done = await listCoordinatorGoals(f.trip, f.as()); assert.equal(done.goals[0].lifecycle, "completed"); assert.match(done.goals[0].outcome?.detail ?? "", /self-reported/);
  assert.equal(done.reports.find(r => r.kind === "completed")?.superseded, false);
  await listCoordinatorGoals(f.trip, f.as());
  assert.equal((await f.db.db.select().from(coordinatorGoalReports).where(eq(coordinatorGoalReports.goalId, a.goal.goalId))).filter(r => r.kind === "completed").length, 1);
  assert.equal((await f.db.db.select().from(polls).where(eq(polls.id, poll.id)))[0].status, "open", "task completion never closes a poll or approves shared state");
}));

test("goals: revoked poll access pauses collection immediately and cannot link or finish as a current round", { skip }, () => scenario(async f => {
  const started = await f.start({ kind: "poll", goal: "Collect a current lodging choice" });
  const audience = { personIds: [f.traveler], guestEmails: [] };
  const data = { title: "Synthetic lodging choice", ballotMode: "transparent", questions: [{ id: randomUUID(), kind: "text", prompt: "What works?", required: false }] };
  const poll = await createCommonsPoll(f.trip, { ...data, commandId: randomUUID(), audience }, f.as());
  await f.op({ op: "link_poll", goalId: started.goal.goalId, expectedRevision: 1, pollId: poll.id, rule: { mode: "manual" } });
  await revokePollRecipient(f.trip, poll.id, { commandId: randomUUID(), kind: "person", recipient: f.traveler, fingerprint: commandFingerprint("", "audience", audience) }, f.as());
  const [saved] = await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.id, started.goal.goalId));
  assert.equal(saved.lifecycle, "waiting_for_input"); assert.equal(saved.outcome, null);
  await assert.rejects(f.op({ op: "finish_collection", goalId: started.goal.goalId, expectedRevision: 1 }));
  await assert.rejects(f.op({ op: "link_poll", goalId: started.goal.goalId, expectedRevision: 1, pollId: poll.id, rule: { mode: "count", count: 1 } }));
  const state = await listCoordinatorGoals(f.trip, f.as());
  assert.equal(state.reports.filter(r => r.kind === "completed").length, 0);
  const replacement = await createCommonsPoll(f.trip, { ...data, commandId: randomUUID(), audience }, f.as());
  await f.op({ op: "link_poll", goalId: started.goal.goalId, expectedRevision: 1, pollId: replacement.id, rule: { mode: "manual" } });
  assert.equal((await f.op({ op: "finish_collection", goalId: started.goal.goalId, expectedRevision: 1 })).goal.lifecycle, "completed");
  assert.equal((await f.db.db.select().from(polls).where(eq(polls.id, poll.id)))[0].status, "revoked");
  assert.equal((await f.db.db.select().from(itineraryItems).where(eq(itineraryItems.commonsId, f.trip))).length, 0);
  await revokePollRecipient(f.trip, replacement.id, { commandId: randomUUID(), kind: "person", recipient: f.traveler, fingerprint: commandFingerprint("", "audience", audience) }, f.as());
  const historical = await listCoordinatorGoals(f.trip, f.as());
  assert.equal(historical.goals[0].lifecycle, "completed"); assert.equal(historical.goals[0].resultStale, true);
  assert.ok(historical.goals[0].outcome, "keep the historical result, do not rewrite it");
  assert.equal(historical.reports.filter(r => r.kind === "completed").length, 1);
  assert.equal(historical.reports.find(r => r.kind === "completed")?.superseded, true);
  // Navigation and report windows differ. These inert synthetic completed rows
  // must not make the older report look current by hiding its task from the rail.
  const fillers = Array.from({ length: 100 }, (_, index) => ({ id: randomUUID(), at: new Date(Date.now() + index + 1) }));
  await f.db.db.insert(coordinatorThreads).values(fillers.map(row => ({ id: row.id, commonsId: f.trip, createdByPersonId: f.owner,
    title: "Synthetic later history", lastCommandId: randomUUID(), lastCommandFingerprint: "synthetic-window-fixture", createdAt: row.at, updatedAt: row.at })));
  const [original] = await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.id, started.goal.goalId));
  await f.db.db.insert(coordinatorGoals).values(fillers.map(row => ({ ...original, id: randomUUID(), threadId: row.id, goalKey: row.id,
    commandId: randomUUID(), fingerprint: "synthetic-window-fixture", outcome: null, outcomeRevision: null, createdAt: row.at, updatedAt: row.at })));
  const outsideWindow = await listCoordinatorGoals(f.trip, f.as());
  assert.equal(outsideWindow.goals.length, 100); assert.ok(outsideWindow.goals.every(goal => goal.goalId !== started.goal.goalId));
  assert.equal(outsideWindow.reports.find(r => r.kind === "completed")?.superseded, true);
}));

test("goals: replacing a poll preserves ballots but never completes collection from the historical closed snapshot", { skip }, () => scenario(async f => {
  const started = await f.start({ kind: "poll", goal: "Collect current options, not historical votes" });
  const questionId = randomUUID(), data = { title: "Synthetic hotel round", intro: null, ballotMode: "transparent", questions: [{ id: questionId, kind: "text", prompt: "What works?", required: false }] };
  const draft = await saveCommonsPollDraft(f.trip, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data }, f.as());
  const published = await createCommonsPoll(f.trip, { ...draft.data, commandId: randomUUID(), draftId: draft.id, draftVersion: draft.version, publicationApproval: { approved: true, access: "link" } }, f.as());
  await f.op({ op: "link_poll", goalId: started.goal.goalId, expectedRevision: 1, pollId: published.id, rule: { mode: "manual" } });
  await submitPublicPollResponseByPublicId(published.publicId, { respondentName: "Synthetic guest", answers: [{ questionId, optionIds: [], text: "Prefer the inn" }] }, databaseUrl);
  const replacement = await reopenCoordinatorDraft(f.trip, draft.id, draft.version, f.as());
  assert.equal((await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.id, started.goal.goalId)))[0].lifecycle, "waiting_for_input");
  await assert.rejects(f.op({ op: "finish_collection", goalId: started.goal.goalId, expectedRevision: 1 }));
  await assert.rejects(f.op({ op: "link_poll", goalId: started.goal.goalId, expectedRevision: 1, pollId: published.id, rule: { mode: "manual" } }));
  assert.equal((await listCoordinatorGoals(f.trip, f.as())).reports.filter(r => r.kind === "completed").length, 0);
  const current = await createCommonsPoll(f.trip, { ...replacement.data, commandId: randomUUID(), draftId: replacement.id, draftVersion: replacement.version, publicationApproval: { approved: true, access: "link" } }, f.as());
  assert.equal(current.responseCount, 0);
  assert.equal((await f.db.db.select().from(pollResponses).where(eq(pollResponses.pollId, published.id))).length, 1);
  await f.op({ op: "link_poll", goalId: started.goal.goalId, expectedRevision: 1, pollId: current.id, rule: { mode: "count", count: 1 } });
  await submitPublicPollResponseByPublicId(current.publicId, { respondentName: "Synthetic new guest", answers: [{ questionId, optionIds: [], text: "Either works" }] }, databaseUrl);
  const state = await listCoordinatorGoals(f.trip, f.as()); assert.equal(state.goals[0].lifecycle, "completed");
  assert.equal(state.reports.filter(r => r.kind === "completed").length, 1);
  assert.equal((await f.db.db.select().from(itineraryItems).where(eq(itineraryItems.commonsId, f.trip))).length, 0);
  await reopenCoordinatorDraft(f.trip, replacement.id, replacement.version, f.as());
  const historical = await listCoordinatorGoals(f.trip, f.as());
  assert.equal(historical.goals[0].resultStale, true); assert.ok(historical.goals[0].outcome);
  assert.equal(historical.reports.find(r => r.kind === "completed")?.superseded, true);
  assert.equal((await f.db.db.select().from(pollResponses).where(eq(pollResponses.pollId, current.id))).length, 1);
}));

async function reviewedBudget(f: Awaited<ReturnType<typeof fixture>>, threadId: string) {
  const [trip] = await f.db.db.select().from(commons).where(eq(commons.id,f.trip));
  const base={budgetCents:trip.targetBudgetCents,startsOn:trip.startsOn,endsOn:trip.endsOn,locationName:trip.locationName,stay:null,includedPersonIds:[]};
  const options={...f.as(),sharedCoordinator:true};
  await commitCoordinatorTurn(f.trip,{commandId:randomUUID(),version:0,threadId,prompt:"Set budget to $3000",draftId:null,draftVersion:null},"Review before applying.",null,options,{tripConversation:true,tripProposal:{version:1,state:"pending",source:"organizer request",base,changes:{...base,budgetCents:300000},operations:["budget"],travelers:[],receipt:null}});
  return (await getCoordinatorThread(f.trip,options,undefined,threadId)).turns[0];
}
test("goals: exact reviewed action completes atomically with actual saved version and one report",{skip},()=>scenario(async f=>{
  const started=await f.start({kind:"plan_action",goal:"Apply the reviewed trip budget",title:"Set trip budget"});
  const turn=await reviewedBudget(f,started.goal.threadId);
  await f.op({op:"link_proposal",goalId:started.goal.goalId,expectedRevision:1,turnId:turn.id});
  assert.equal((await f.db.db.select().from(commons).where(eq(commons.id,f.trip)))[0].targetBudgetCents,null);
  const action={turnId:turn.id,threadId:started.goal.threadId,commandId:randomUUID(),action:"apply_trip" as const,expectedVersion:1};
  await actOnCoordinatorWorkspace(f.trip,action,{...f.as(),sharedCoordinator:true});
  await actOnCoordinatorWorkspace(f.trip,action,{...f.as(),sharedCoordinator:true});
  const [trip]=await f.db.db.select().from(commons).where(eq(commons.id,f.trip));
  const [goal]=await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.id,started.goal.goalId));
  assert.equal(goal.lifecycle,"completed");assert.equal(trip.targetBudgetCents,300000);assert.equal(goal.outcome?.receipt?.version,trip.updatedAt.toISOString());
  assert.equal((await listCoordinatorGoals(f.trip,f.as())).reports.filter(r=>r.kind==="completed").length,1);
}));
test("goals: cancellation fences already prepared review; cross-trip objects and stale idea versions refuse",{skip},()=>scenario(async f=>{
  const started=await f.start({kind:"plan_action"});const turn=await reviewedBudget(f,started.goal.threadId);
  await f.op({op:"link_proposal",goalId:started.goal.goalId,expectedRevision:1,turnId:turn.id});
  await f.op({op:"cancel",goalId:started.goal.goalId,expectedRevision:1});
  await assert.rejects(actOnCoordinatorWorkspace(f.trip,{turnId:turn.id,threadId:started.goal.threadId,commandId:randomUUID(),action:"apply_trip",expectedVersion:1},{...f.as(),sharedCoordinator:true}));
  assert.equal((await f.db.db.select().from(commons).where(eq(commons.id,f.trip)))[0].targetBudgetCents,null);
  const [idea]=await f.db.db.insert(itineraryItems).values({commonsId:f.trip,title:"Wine van",status:"idea",audience:"everyone",timezone:"America/Denver",provenanceLabel:"Synthetic"}).returning();
  await assert.rejects(f.start({ideaIds:[idea.id],ideaVersions:[{id:idea.id,version:new Date(0).toISOString()}]}));
  await assert.rejects(f.start({ideaIds:[randomUUID()]}));
  assert.equal((await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.commonsId,f.trip))).length,1);
}));
test("goals: additive backfill gives each legacy task a conversation, preserves exact runs and flag-off reads",{skip},()=>scenario(async f=>{
  const options={...f.as(),sharedCoordinator:true},thread=await createCoordinatorThread(f.trip,{commandId:randomUUID(),title:"Earlier research"},options);
  const started=[];
  for(const title of ["Transfer A","Transfer B"]){const task=await startCoordinatorTask({protocolVersion:1,commandId:randomUUID(),commonsId:f.trip,threadId:thread.id,parentTaskId:null,caller:{kind:"human",personId:f.owner},capability:"research.public_sources",input:{query:"Same public transfer query"},routing:{kind:"commons_specialist"},returnTo:{kind:"commons_thread",threadId:thread.id}},{title,brief:title,contextVersion:0},f.as());started.push(task.task);const lease=await claimResearchTask(databaseUrl);assert.ok(lease);await finishResearchTaskDetailed(lease,{result:{query:lease.query,sources:[],status:"partial",limitations:[]}},databaseUrl);}
  const oldThreads=await f.db.db.select().from(coordinatorThreads).where(eq(coordinatorThreads.commonsId,f.trip));
  const first=await listCoordinatorGoals(f.trip,f.as()),second=await listCoordinatorGoals(f.trip,f.as());
  assert.equal(first.goals.length,2);assert.equal(second.goals.length,2);assert.notEqual(first.goals[0].threadId,first.goals[1].threadId);
  assert.equal(first.reports.length,0,"backfill is not a new completion or inference");
  for(const goal of first.goals){assert.equal(goal.sourceThreadId,thread.id);assert.equal(goal.research?.runIds.length,1);}
  assert.notEqual(first.goals[0].research?.runIds[0],first.goals[1].research?.runIds[0]);
  assert.ok((await f.db.db.select().from(coordinatorThreads).where(eq(coordinatorThreads.commonsId,f.trip))).some(t=>t.id===oldThreads[0].id));
  assert.equal((await listCoordinatorTasks(f.trip,thread.id,f.as())).length,2,"legacy read path survives navigation flag rollback");
  await assert.rejects(cancelCoordinatorTask({taskId:started[0].taskId,commandId:randomUUID()},f.as()),"legacy controls cannot bypass a managed goal revision");
}));
test("goals: poll response transaction projects once, secret ballots stay private, deletion marks earlier outcome",{skip},()=>scenario(async f=>{
  const started=await f.start({kind:"poll",goal:"Collect one anonymous response"});
  const questionId=randomUUID(),early=randomUUID(),late=randomUUID();
  const [poll]=await f.db.db.insert(polls).values({commonsId:f.trip,createdByPersonId:f.owner,title:"Synthetic secret poll",commandId:randomUUID(),questions:[{id:questionId,prompt:"Pick a time",kind:"choice",options:[{id:early,label:"Early",description:null,exclusive:false},{id:late,label:"Late",description:null,exclusive:false}],required:true,selectionMode:"single"}],ballotMode:"secret",shareTokenHash:randomUUID(),shareTokenValue:randomUUID()}).returning();
  await f.op({op:"link_poll",goalId:started.goal.goalId,expectedRevision:1,pollId:poll.id,rule:{mode:"count",count:1}});
  await submitPublicPollResponseByPublicId(poll.publicId,{respondentName:"Self reported",answers:[{questionId,optionIds:[early]}]},databaseUrl);
  const [goal]=await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.id,started.goal.goalId));
  assert.equal(goal.lifecycle,"completed");assert.match(goal.outcome?.detail??"",/private until voting closes/);assert.doesNotMatch(goal.outcome?.detail??"",/Early 1/);
  const [response]=await f.db.db.select().from(pollResponses).where(eq(pollResponses.pollId,poll.id));
  await deleteCommonsPollResponse(f.trip,poll.id,response.id,f.as());
  assert.equal((await listCoordinatorGoals(f.trip,f.as())).goals[0].resultStale,true);
  assert.equal((await f.db.db.select().from(coordinatorGoalReports).where(eq(coordinatorGoalReports.goalId,started.goal.goalId))).filter(r=>r.kind==="completed").length,1);
}));
test("goals: heartbeat must be recent, past and observed; configuration alone is insufficient",{skip},async()=>{
  const at=new Date("2026-10-01T20:00:00Z");await recordResearchWorkerHeartbeat(databaseUrl,at);
  assert.equal(await researchWorkerHealthy(databaseUrl,new Date(at.getTime()+30000)),true);
  assert.equal(await researchWorkerHealthy(databaseUrl,new Date(at.getTime()+90000)),false);
  assert.equal(await researchWorkerHealthy(databaseUrl,new Date(at.getTime()-1)),false);
});

// Worker ticks are real database transactions; restarting/concurrent timers must project only once.
test("goals: concurrent deadline ticks complete once without closing the poll; expired work stops",{skip},()=>scenario(async f=>{
  const started=await f.start({kind:"poll",goal:"Collect until the explicitly chosen deadline"});
  const [poll]=await f.db.db.insert(polls).values({commonsId:f.trip,createdByPersonId:f.owner,title:"Synthetic deadline poll",commandId:randomUUID(),questions:[],ballotMode:"transparent",shareTokenHash:randomUUID(),shareTokenValue:randomUUID()}).returning();
  const deadline=new Date(Date.now()+60000);
  await f.op({op:"link_poll",goalId:started.goal.goalId,expectedRevision:1,pollId:poll.id,rule:{mode:"deadline",at:deadline.toISOString()}});
  await tickCoordinatorGoals({databaseUrl,now:new Date(deadline.getTime()-1)});
  assert.equal((await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.id,started.goal.goalId)))[0].lifecycle,"waiting_for_event");
  await Promise.all([tickCoordinatorGoals({databaseUrl,now:deadline}),tickCoordinatorGoals({databaseUrl,now:deadline})]);
  await tickCoordinatorGoals({databaseUrl,now:deadline});
  assert.equal((await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.id,started.goal.goalId)))[0].lifecycle,"completed");
  assert.equal((await f.db.db.select().from(coordinatorGoalReports).where(eq(coordinatorGoalReports.goalId,started.goal.goalId))).filter(r=>r.kind==="completed").length,1);
  assert.equal((await f.db.db.select().from(polls).where(eq(polls.id,poll.id)))[0].status,"open");
  const expired=await f.start({kind:"plan_action",title:"Expired review",goal:"Wait for a human review"});
  await tickCoordinatorGoals({databaseUrl,now:new Date(Date.now()+8*24*3600000)});
  const [goal]=await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.id,expired.goal.goalId));
  assert.equal(goal.lifecycle,"failed");assert.equal(goal.errorCode,"deadline_exceeded");
}));

test("goals: a poll response after the task time budget preserves the ballot but cannot publish a task result",{skip},()=>scenario(async f=>{
 const started=await f.start({kind:"poll",goal:"Collect one response before the task expires"});
 const questionId=randomUUID(),optionId=randomUUID();
 const [poll]=await f.db.db.insert(polls).values({commonsId:f.trip,createdByPersonId:f.owner,title:"Expired task poll",commandId:randomUUID(),questions:[{id:questionId,prompt:"Pick a time",kind:"choice",options:[{id:optionId,label:"Early",description:null,exclusive:false},{id:randomUUID(),label:"Late",description:null,exclusive:false}],required:true,selectionMode:"single"}],ballotMode:"transparent",shareTokenHash:randomUUID(),shareTokenValue:randomUUID()}).returning();
 await f.op({op:"link_poll",goalId:started.goal.goalId,expectedRevision:1,pollId:poll.id,rule:{mode:"count",count:1}});
 await f.db.db.update(coordinatorGoalSteps).set({createdAt:new Date(Date.now()-8*24*3600000)}).where(eq(coordinatorGoalSteps.goalId,started.goal.goalId));
 await submitPublicPollResponseByPublicId(poll.publicId,{respondentName:"Late self reported",answers:[{questionId,optionIds:[optionId]}]},databaseUrl);
 const [goal]=await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.id,started.goal.goalId));assert.equal(goal.lifecycle,"failed");assert.equal(goal.errorCode,"deadline_exceeded");assert.equal(goal.outcome,null);
 assert.equal((await f.db.db.select().from(pollResponses).where(eq(pollResponses.pollId,poll.id))).length,1);
 const reports=(await listCoordinatorGoals(f.trip,f.as())).reports;assert.equal(reports.filter(r=>r.kind==="completed").length,0);assert.equal(reports.filter(r=>r.kind==="failed").length,1);
}));
