import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { commons, stays, listTripTasks, saveTripTask, memberships } from "@commons/database";
import { syntheticItinerary } from "../../../../packages/contracts/src/fixtures/research-itinerary";
import { databaseTestsEnabled, withCoordinatorScenario, withTestDatabase, eq, jsonRequest, params, actAs } from "./coordinator-route-harness";
const environment = { COMMONS_ASSISTANT_UI_ENABLED: "true", COMMONS_COORDINATOR_INFERENCE_POLICY: "openai-luna-none" };

test("natural itinerary construction/refinement persists one draft; ordinary questions stay on Luna", { skip: !databaseTestsEnabled }, () => withCoordinatorScenario(async s => {
  await withTestDatabase(async db => { await db.update(commons).set({ startsOn: "2026-11-05", endsOn: "2026-11-07" }).where(eq(commons.id, s.trip.eventId)); await db.update(stays).set({ name: "Lodge at Sonoma" }).where(eq(stays.id, s.trip.stayId)); });
  s.next.extra = syntheticItinerary();
  const threadId = randomUUID();
  const first = await s.post(s.command({ target: { kind: "new", threadId }, text: "Build a Thursday to Saturday itinerary from our saved base." }));
  assert.equal(first.body.status, "completed", JSON.stringify(first.body));
  const original = (await s.thread(threadId)).turns.at(-1).workspace.itineraryDraft;
  assert.equal(s.network.providerCalls.at(-1)?.body.model, "gpt-6.1-terra");
  assert.equal((s.network.providerCalls.at(-1)?.body as Record<string, unknown>).reasoning_effort, "low");
  s.next.extra = syntheticItinerary();
  const refined = await s.post(s.command({ target: { kind: "existing", threadId, expectedTurnVersion: first.body.thread.turnVersion }, text: "Less driving, please." }));
  assert.equal(refined.body.status, "completed");
  assert.equal((await s.thread(threadId)).turns.at(-1).workspace.itineraryDraft.id, original.id);
  s.next.extra = {}; s.next.reply = "Keep the lodging and dates unchanged; the itinerary is only a draft.";
  const question = await s.post(s.command({ target: { kind: "existing", threadId, expectedTurnVersion: refined.body.thread.turnVersion }, text: "How should we think about this draft?" }));
  assert.equal(question.body.status, "completed");
  assert.equal(s.network.providerCalls.at(-1)?.body.model, "gpt-6-luna");
  assert.equal((await s.thread(threadId)).turns.at(-1).workspace?.itineraryDraft, undefined);
  assert.match(JSON.stringify(s.network.providerCalls.at(-1)?.body), /Read-only|itineraryDraft/);
}, { environment }));

test("task proposal/refinement uses no model; approval saves one real task, replay deduplicates and stale reviews reject", { skip: !databaseTestsEnabled }, () => withCoordinatorScenario(async s => {
  const threadId = randomUUID(), options = { actorPersonId: s.trip.organizerId, databaseUrl: process.env.TEST_DATABASE_URL! };
  const first = await s.post(s.command({ target: { kind: "new", threadId }, text: "Create a task for me to arrange a shared van from Oakland airport to the lodge. Flight times are unknown." }));
  assert.equal(first.body.status, "completed", JSON.stringify(first.body));
  assert.equal(first.body.reviewRequired, true); assert.equal(s.network.providerCalls.length, 0);
  const firstTurn = (await s.thread(threadId)).turns.at(-1);
  assert.equal((await listTripTasks(s.trip.eventId, options)).length, 0);
  const refined = await s.post(s.command({ target: { kind: "existing", threadId, expectedTurnVersion: first.body.thread.turnVersion }, text: "Make the task include confirming luggage and child seats. Do not book or contact anyone." }));
  assert.equal(refined.body.status, "completed");
  const turn = (await s.thread(threadId)).turns.at(-1), proposal = turn.workspace.taskProposal;
  assert.equal(proposal.task.id, firstTurn.workspace.taskProposal.task.id); assert.equal(proposal.version, 2);
  const review = (turnId = turn.id, expectedVersion = 2, commandId = randomUUID()) => ({ action: "trip_task", operation: "apply", turnId, threadId, expectedVersion, commandId });
  const stale = await s.routes.turn.PATCH(jsonRequest(s.trip.eventId, "", "PATCH", review(firstTurn.id, 1)), params(s.trip.eventId)); assert.equal(stale.status, 409);
  const action = review();
  for (let i = 0; i < 2; i++) assert.equal((await s.routes.turn.PATCH(jsonRequest(s.trip.eventId, "", "PATCH", action), params(s.trip.eventId))).status, 200);
  const [task] = await listTripTasks(s.trip.eventId, options);
  assert.match(task.title, /luggage and child seats/); assert.equal(task.version, 1); assert.equal(s.network.providerCalls.length, 0);
  assert.equal((await s.thread(threadId)).turns.at(-1).workspace.taskProposal.receipt.id, task.id);
  assert.equal((await s.routes.turn.PATCH(jsonRequest(s.trip.eventId, "", "PATCH", { ...action, operation: "dismiss" }), params(s.trip.eventId))).status, 409);
  await withTestDatabase(db => db.update(memberships).set({ status: "removed" }).where(eq(memberships.personId, s.trip.organizerId)));
  actAs(s.trip.organizerId);
  assert.notEqual((await s.routes.turn.PATCH(jsonRequest(s.trip.eventId, "", "PATCH", action), params(s.trip.eventId))).status, 200);
}, { environment }));

test("direct task edit fences a stale conversation proposal", { skip: !databaseTestsEnabled }, () => withCoordinatorScenario(async s => {
  const threadId = randomUUID(), options = { actorPersonId: s.trip.organizerId, databaseUrl: process.env.TEST_DATABASE_URL! };
  const first = await s.post(s.command({ target: { kind: "new", threadId }, text: "Create a task for me to confirm the van." }));
  const turn = (await s.thread(threadId)).turns.at(-1), task = turn.workspace.taskProposal.task;
  await saveTripTask(s.trip.eventId, { ...task, commandId: randomUUID(), title: "Organizer's direct edit" }, options);
  const result = await s.routes.turn.PATCH(jsonRequest(s.trip.eventId, "", "PATCH", { action: "trip_task", operation: "apply", turnId: turn.id, threadId, commandId: randomUUID(), expectedVersion: 1 }), params(s.trip.eventId));
  assert.equal(result.status, 409); assert.equal((await listTripTasks(s.trip.eventId, options))[0].title, "Organizer's direct edit");
  assert.equal(first.body.status, "completed");
}, { environment }));

test("a replayed child command cannot turn stale first-time approval into a fresh save receipt", { skip: !databaseTestsEnabled }, () => withCoordinatorScenario(async s => {
  const threadId = randomUUID(), options = { actorPersonId: s.trip.organizerId, databaseUrl: process.env.TEST_DATABASE_URL! };
  await s.post(s.command({ target: { kind: "new", threadId }, text: "Create a task for me to confirm a van." }));
  const turn = (await s.thread(threadId)).turns.at(-1), task = turn.workspace.taskProposal.task;
  await saveTripTask(s.trip.eventId, task, options);
  await saveTripTask(s.trip.eventId, { ...task, commandId: randomUUID(), expectedVersion: 1, title: "Direct editor's newer title" }, options);
  const result = await s.routes.turn.PATCH(jsonRequest(s.trip.eventId, "", "PATCH", { action: "trip_task", operation: "apply", turnId: turn.id, threadId, commandId: randomUUID(), expectedVersion: 1 }), params(s.trip.eventId));
  assert.equal(result.status, 409);
  assert.equal((await s.thread(threadId)).turns.at(-1).workspace.taskProposal.state, "pending");
  assert.equal((await listTripTasks(s.trip.eventId, options))[0].version, 2);
}, { environment }));


test("slash task quick-add is durable and replay-safe; undo is scoped, replay-safe and stale-safe", { skip: !databaseTestsEnabled }, () => withCoordinatorScenario(async s => {
 const options={actorPersonId:s.trip.organizerId,databaseUrl:process.env.TEST_DATABASE_URL!}, command=s.command({text:"/task Ask john to each donuts"});
 const first=await s.post(command); assert.equal(first.body.status,"completed",JSON.stringify(first.body)); assert.equal(first.body.reviewRequired,false); assert.match(first.body.durableAnswer,/Added your task/);
 await s.post(command); const turn=(await s.thread(first.body.thread.id)).turns.at(-1), proposal=turn.workspace.taskProposal;
 assert.equal(proposal.state,"applied"); assert.equal(proposal.task.ownerPersonId,s.trip.organizerId); assert.equal((await listTripTasks(s.trip.eventId,options)).length,1); assert.equal(s.network.providerCalls.length,0);
 const undo={action:"trip_task",operation:"undo",turnId:turn.id,threadId:first.body.thread.id,expectedVersion:proposal.version,commandId:randomUUID()};
 actAs(s.trip.coOrganizerId);
 assert.notEqual((await s.routes.turn.PATCH(jsonRequest(s.trip.eventId,"","PATCH",{...undo,commandId:randomUUID()}),params(s.trip.eventId))).status,200);
 actAs(s.trip.organizerId);
 for(let i=0;i<2;i++) assert.equal((await s.routes.turn.PATCH(jsonRequest(s.trip.eventId,"","PATCH",undo),params(s.trip.eventId))).status,200);
 assert.equal((await listTripTasks(s.trip.eventId,options)).length,0); assert.equal((await s.thread(first.body.thread.id)).turns.at(-1).workspace.taskProposal.state,"dismissed");
 await s.post(command);assert.equal((await listTripTasks(s.trip.eventId,options)).length,0,"replaying the original request after Undo cannot recreate the task");
 const second=await s.post(s.command({text:"/task Pack a charger"})), secondTurn=(await s.thread(second.body.thread.id)).turns.at(-1), task=secondTurn.workspace.taskProposal.task;
 await saveTripTask(s.trip.eventId,{...task,commandId:randomUUID(),expectedVersion:1,title:"Newer human edit"},options);
 const stale=await s.routes.turn.PATCH(jsonRequest(s.trip.eventId,"","PATCH",{...undo,turnId:secondTurn.id,threadId:second.body.thread.id,commandId:randomUUID()}),params(s.trip.eventId));assert.equal(stale.status,409);assert.equal((await listTripTasks(s.trip.eventId,options))[0].title,"Newer human edit");
},{environment}));
