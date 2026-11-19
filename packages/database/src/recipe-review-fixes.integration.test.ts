import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { attendanceQuestions, datesLocationQuestions, type LodgingPropertyInput } from "@commons/contracts";
import { createDatabase } from "./client";
import { commons, memberships, people, pollDecisions, recipeOutcomes } from "./schema";
import { listCoordinatorGoals } from "./coordinator-goal-repository";
import { getCommonsPollDetail, getPublicPollByPublicId, submitPublicPollResponseByPublicId, updateCommonsPollStatus } from "./poll-repository";
import { approveRecipeOutcome, getRecipeRun, publishRecipeRound, reviseRecipeRound, startRecipeRun } from "./recipe-run-repository";
import { getTransportReview } from "./recipe-transport-repository";
import { upsertCommonsFlightBooking } from "./pilot-repository";

const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
test("legacy/public recap privacy, truthful Goal actions and reconsidered attendance share the same saved evidence", { skip }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(url).hostname, "127.0.0.1"); assert.ok(new URL(url).pathname.endsWith("_test"));
  const db = createDatabase(url), trip = randomUUID(), ids = [randomUUID(), randomUUID()], [org, traveler] = ids;
  const options = { databaseUrl: url, actorPersonId: org }, privateText = "PRIVATE: Sam needs a ground floor";
  await db.db.insert(people).values(ids.map((id,i) => ({ id, authUserId: id, displayName: i ? "Traveler" : "Organizer" })));
  await db.db.insert(commons).values({ id: trip, slug: trip, name: "Review fixes synthetic", createdByPersonId: org, timezone: "America/Los_Angeles", startsOn: "2027-04-15", endsOn: "2027-04-17" });
  await db.db.insert(memberships).values(ids.map(id => ({ commonsId: trip, personId: id, role: id === org ? "organizer" as const : "member" as const, status: "active" as const })));
  const start = async (recipe: "attendance" | "dates_location", extras: object = {}) => {
    const runId = randomUUID();
    await startRecipeRun(trip, { commandId: randomUUID(), runId, draftId: randomUUID(), recipe, ...extras }, { ...options, createPlanningGoal: true });
    const run = await getRecipeRun(trip,runId,options);
    const published = await publishRecipeRound(trip,runId,{commandId:randomUUID(),expectedDraftVersion:run.draft.version,access:"invitees"},options);
    return { runId, ...published };
  };
  const close = (id:string) => updateCommonsPollStatus(trip,id,{commandId:randomUUID(),status:"closed"},options);
  const assertLegacy = async (runId:string,pollId:string,publicId:string) => {
    const [outcome] = await db.db.select().from(recipeOutcomes).where(eq(recipeOutcomes.runId,runId));
    await db.db.update(pollDecisions).set({summary:`Earlier recorded decision. Exceptions noted: ${privateText}`}).where(eq(pollDecisions.id,outcome.decisionId));
    const publicView = await getPublicPollByPublicId(publicId,url,{authUserId:org,email:null});
    assert.doesNotMatch(JSON.stringify(publicView),/PRIVATE|ground floor|recipeResult|exceptions/);
    const travelerDetail = await getCommonsPollDetail(trip,pollId,{...options,actorPersonId:traveler});
    assert.equal(travelerDetail.decision!.summary,publicView!.decision!.summary);
    assert.doesNotMatch(JSON.stringify(travelerDetail),/PRIVATE|ground floor|recipeResult|exceptions/,"the signed-in trip detail path uses the same participant boundary");
    const run = await getRecipeRun(trip,runId,options);
    assert.equal(run.participantDecision?.summary,publicView!.decision!.summary);
    assert.doesNotMatch(run.participantDecision!.summary,/PRIVATE|ground floor/);
    assert.match((await getCommonsPollDetail(trip,pollId,options)).decision!.summary,/PRIVATE/,"original organizer approval is preserved, not rewritten");
    assert.ok(run.outcome!.result.kind !== "food_preferences" && run.outcome!.result.exceptions.includes(privateText));
    // Even malformed legacy JSON must not fall back to its private raw summary.
    await db.db.update(recipeOutcomes).set({result:sql`'null'::jsonb`}).where(eq(recipeOutcomes.id,outcome.id));
    try {
      const malformedPublic=await getPublicPollByPublicId(publicId,url,{authUserId:org,email:null});
      const malformedDetail=await getCommonsPollDetail(trip,pollId,{...options,actorPersonId:traveler});
      assert.doesNotMatch(JSON.stringify(malformedPublic),/PRIVATE|ground floor|recipeResult|recipeOutcomeId/);
      assert.equal(malformedDetail.decision!.summary,malformedPublic!.decision!.summary);
      assert.doesNotMatch(JSON.stringify(malformedDetail),/PRIVATE|ground floor|recipeResult|recipeOutcomeId/);
    } finally { await db.db.update(recipeOutcomes).set({result:outcome.result}).where(eq(recipeOutcomes.id,outcome.id)); }
  };
  try {
    const empty=await start("attendance"); await close(empty.pollId);
    const emptyGoal=(await listCoordinatorGoals(trip,options)).goals.find(g=>g.planning?.runId===empty.runId)!;
    assert.equal(emptyGoal.planning?.label,"Voting closed · no answers"); assert.equal(emptyGoal.planning?.action,"view_round");
    const dates=await start("dates_location",{alternatives:[{id:randomUUID(),startsOn:"2027-04-15",endsOn:"2027-04-17",place:"Sonoma"},{id:randomUUID(),startsOn:"2027-04-22",endsOn:"2027-04-24",place:"Napa"}]});
    const dq=datesLocationQuestions((await getCommonsPollDetail(trip,dates.pollId,options)).questions)!;
    const chosen=dq.acceptable.options.find(o=>o.alternative)!;
    for(const id of ids)await submitPublicPollResponseByPublicId(dates.publicId,{expectedResponseUpdatedAt:null,answers:[{questionId:dq.acceptable.id,optionIds:[chosen.id],text:null}]},url,{authUserId:id,email:null});
    const ready=(await listCoordinatorGoals(trip,options)).goals.find(g=>g.planning?.runId===dates.runId)!;
    assert.equal(ready.planning?.action,"close_voting"); assert.equal(ready.planning?.label,"Answers ready to review"); assert.equal((await getRecipeRun(trip,dates.runId,options)).poll!.status,"open");
    await close(dates.pollId); let run=await getRecipeRun(trip,dates.runId,options);
    await approveRecipeOutcome(trip,dates.runId,{commandId:randomUUID(),pollId:dates.pollId,evidenceFingerprint:run.evidenceFingerprint,alternativeId:chosen.id,exceptions:[privateText],uncertaintyAcknowledged:true},options);
    await assertLegacy(dates.runId,dates.pollId,dates.publicId);
    const attendance=await start("attendance"), aq=attendanceQuestions((await getCommonsPollDetail(trip,attendance.pollId,options)).questions)!;
    for(const id of ids)await submitPublicPollResponseByPublicId(attendance.publicId,{expectedResponseUpdatedAt:null,answers:[{questionId:aq.state.id,optionIds:[aq.state.options.find(o=>o.attendance==="in")!.id],text:null}]},url,{authUserId:id,email:null});
    await close(attendance.pollId); run=await getRecipeRun(trip,attendance.runId,options);
    await approveRecipeOutcome(trip,attendance.runId,{commandId:randomUUID(),pollId:attendance.pollId,evidenceFingerprint:run.evidenceFingerprint,exceptions:[privateText],uncertaintyAcknowledged:true},options);
    await assertLegacy(attendance.runId,attendance.pollId,attendance.publicId);
    for(const id of ids)await upsertCommonsFlightBooking(trip,{commandId:randomUUID(),legs:[{kind:"arrival",route:"DEN → SFO",date:"2027-04-15",time:id===org?"11:00":"11:15"}],includedPersonIds:[id],note:""},{...options,actorPersonId:id});
    assert.equal((await getTransportReview(trip,options)).proposal.groups[0].confirmedCount,2);
    const previous=await getRecipeRun(trip,attendance.runId,options);
    await reviseRecipeRound(trip,attendance.runId,{commandId:randomUUID(),expectedDraftVersion:previous.draft.version},options);
    const transport=await getTransportReview(trip,options);
    assert.equal(transport.context.sources.find(s=>s.kind==="attendance")?.reconsidering,true);
    assert.equal(transport.context.attendance?.in,2,"last reviewed result stays intact while being reconsidered");
    assert.equal(transport.proposal.groups[0].confirmedCount,0,"old poll attendance no longer masquerades as current confirmation");
    const properties:LodgingPropertyInput[]=["House A","House B"].map((name,index)=>({id:randomUUID(),name,url:`https://example.com/house-${index}`,description:null,rooms:"Two rooms",beds:"unknown",pricing:{basis:"total",period:"stay",currency:"USD",minCents:null,maxCents:null,fees:"unknown"}}));
    const stayId=randomUUID(); await startRecipeRun(trip,{commandId:randomUUID(),runId:stayId,draftId:randomUUID(),recipe:"lodging",properties},options);
    const stay=await getRecipeRun(trip,stayId,options);
    assert.equal(stay.context?.saved?.sources.find(s=>s.kind==="attendance")?.reconsidering,true);
    const [recorded]=await db.db.select().from(recipeOutcomes).where(eq(recipeOutcomes.runId,attendance.runId));
    assert.equal(recorded.status,"approved","asking again neither undoes nor supersedes the approval before replacement");
    const revisedAttendance = await getRecipeRun(trip, attendance.runId, options);
    const unanswered = await publishRecipeRound(trip, attendance.runId, { commandId: randomUUID(), expectedDraftVersion: revisedAttendance.draft.version, access: "invitees" }, options);
    await close(unanswered.pollId); const emptyAttendance = await getRecipeRun(trip, attendance.runId, options);
    const approval = { pollId: unanswered.pollId, evidenceFingerprint: emptyAttendance.evidenceFingerprint, exceptions: ["Not an attendance answer"], uncertaintyAcknowledged: true };
    await assert.rejects(approveRecipeOutcome(trip, attendance.runId, { ...approval, commandId: randomUUID() }, options), /attendance answer|organizer-attributed note/);
    assert.equal((await db.db.select().from(recipeOutcomes).where(eq(recipeOutcomes.runId, attendance.runId))).length, 1);
    assert.equal((await getTransportReview(trip, options)).context.attendance?.in, 2, "Empty approval cannot replace a real headcount");
    await approveRecipeOutcome(trip, attendance.runId, { ...approval, commandId: randomUUID(), organizerEntries: [{ personId: org, state: "in", partySize: 1, note: "Explicit synthetic organizer report" }] }, options);
    assert.equal((await getTransportReview(trip, options)).context.attendance?.in, 1, "An explicit attributed organizer report can support a new result");
  } finally { await db.db.delete(commons).where(eq(commons.id,trip)); await db.db.delete(people).where(inArray(people.id,ids)); await db.close(); }
});
