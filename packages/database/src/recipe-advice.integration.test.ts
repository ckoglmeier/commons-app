import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { type DatesLocationConfiguration, type DatesLocationRunDetail } from "@commons/contracts";
import { createDatabase } from "./client";
import { CommandAccessError, CommandConflictError } from "./event-command";
import { getCommonsPollDetail, submitPublicPollResponseByPublicId, updateCommonsPollStatus } from "./poll-repository";
import { adoptRecipeAdvice, applyRecipeOutcome, approveRecipeOutcome, getRecipeRun, publishRecipeRound, reviseRecipeRound, saveRecipeInputs, startRecipeRun } from "./recipe-run-repository";
import { commons, memberships, people, pollDecisions, pollDrafts, pollResponses, polls, recipeOutcomes, recipeRuns } from "./schema";

const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
const dates = () => [{ id: randomUUID(), startsOn: "2026-11-10", endsOn: "2026-11-13" }, { id: randomUUID(), startsOn: "2026-11-17", endsOn: "2026-11-20" }];
const config = (): DatesLocationConfiguration => ({ version: 2, blocks: [
  { id: randomUUID(), type: "dates", prompt: "Which dates work?", required: true, options: dates() },
  { id: randomUUID(), type: "location", prompt: "Which places interest you?", required: true, options: [{ id: randomUUID(), place: "Portland" }, { id: randomUUID(), place: "Denver" }] },
] });
async function fixture() {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname));
  assert.match(new URL(url).pathname, /_test$/);
  const database = createDatabase(url), tripId = randomUUID(), org = randomUUID(), participant = randomUUID(), outsider = randomUUID(), runId = randomUUID(), draftId = randomUUID();
  await database.db.insert(people).values([org, participant, outsider].map((id, index) => ({ id, displayName: ["Advice Organizer", "Advice Participant", "Outside Person"][index], authUserId: id })));
  await database.db.insert(commons).values({ id: tripId, slug: tripId, name: "Advice integration fixture", createdByPersonId: org, timezone: "America/Denver" });
  await database.db.insert(memberships).values([{ commonsId: tripId, personId: org, role: "organizer", status: "active" }, { commonsId: tripId, personId: participant, role: "member", status: "active" }]);
  const options = { databaseUrl: url, actorPersonId: org };
  const detail = async () => await getRecipeRun(tripId, runId, options) as DatesLocationRunDetail;
  const start = async (configuration = config()) => startRecipeRun(tripId, { commandId: randomUUID(), runId, draftId, recipe: "dates_location", configuration }, options);
  const publish = async () => {
    const d = await detail(), result = await publishRecipeRound(tripId, runId, { commandId: randomUUID(), expectedDraftVersion: d.draft.version, access: "invitees" }, options);
    return getCommonsPollDetail(tripId, result.pollId, options);
  };
  const respond = async (poll: Awaited<ReturnType<typeof publish>>, need = false) => {
    for (const personId of [org, participant]) await submitPublicPollResponseByPublicId(poll.publicId, { expectedResponseUpdatedAt: null, answers: poll.questions.map((question, index) => {
      if (question.kind === "text") throw new Error("Fixture contains no text questions");
      return { questionId: question.id, optionIds: question.kind === "choice" ? question.options.filter(option => !option.exclusive).map(option => option.id) : [], text: null,
        ...(question.kind === "option_response" ? { optionResponses: question.options.map(option => ({ optionId: option.id, value: question.scale === "interest" ? "interested" : "yes" })) } : {}),
        ...(need && personId === participant && index === 1 ? { context: { kind: "need", text: "Own bed for the chosen option" } } : {}) };
    }) }, url, { authUserId: personId, email: null });
  };
  const close = (pollId: string) => updateCommonsPollStatus(tripId, pollId, { commandId: randomUUID(), status: "closed" }, options);
  const revise = async () => reviseRecipeRound(tripId, runId, { commandId: randomUUID(), expectedDraftVersion: (await detail()).draft.version }, options);
  const cleanup = async () => { await database.db.delete(commons).where(eq(commons.id, tripId)); await database.db.delete(people).where(inArray(people.id, [org, participant, outsider])); await database.close(); };
  return { database, tripId, org, participant, outsider, runId, draftId, options, start, detail, publish, respond, close, revise, cleanup };
}

test("rules advice adoption is private, fresh, replay-safe and run-scoped", { skip }, async () => {
  const f = await fixture();
  try {
    await f.start(); const first = await f.publish(); await f.respond(first); await f.close(first.id); await f.revise();
    let d = await f.detail(); assert.equal(d.advice?.proposedConfiguration?.blocks[0].type, "combination");
    const request = () => ({ commandId: randomUUID(), expectedDraftVersion: d.draft.version, evidenceFingerprint: d.connectedEvidence!.fingerprint, sourcePollIds: d.connectedEvidence!.sources.map(source => source.pollId) });
    const stale = request();
    await f.database.db.update(memberships).set({ status: "invited" }).where(and(eq(memberships.commonsId, f.tripId), eq(memberships.personId, f.participant)));
    await assert.rejects(adoptRecipeAdvice(f.tripId, f.runId, stale, f.options), /out of date/);
    d = await f.detail();
    await assert.rejects(adoptRecipeAdvice(f.tripId, f.runId, { ...request(), sourcePollIds: [randomUUID()] }, f.options), /does not belong/);
    await assert.rejects(adoptRecipeAdvice(f.tripId, f.runId, request(), { ...f.options, actorPersonId: f.participant }), CommandAccessError);
    const ownSecond = await startRecipeRun(f.tripId, { commandId: randomUUID(), runId: randomUUID(), draftId: randomUUID(), recipe: "dates_location", configuration: config() }, f.options);
    const foreign = await publishRecipeRound(f.tripId, ownSecond.runId, { commandId: randomUUID(), expectedDraftVersion: 1, access: "invitees" }, f.options);
    await assert.rejects(adoptRecipeAdvice(f.tripId, f.runId, { ...request(), sourcePollIds: [foreign.pollId] }, f.options), /does not belong/);
    const command = request(), result = await adoptRecipeAdvice(f.tripId, f.runId, command, f.options);
    assert.deepEqual(await adoptRecipeAdvice(f.tripId, f.runId, command, f.options), result);
    const [saved] = await f.database.db.select().from(pollDrafts).where(eq(pollDrafts.id, result.draftId));
    assert.equal(saved.publishedPollId, null); assert.equal(saved.data.recipeConfiguration?.blocks[0].type, "combination");
    assert.equal((await f.database.db.select().from(polls).where(eq(polls.commonsId, f.tripId))).length, 2, "advice did not publish a third poll");
    assert.equal((await f.database.db.select().from(pollResponses).where(eq(pollResponses.pollId, first.id))).length, 2, "earlier votes were not copied");
    assert.equal((await f.database.db.select().from(recipeOutcomes).innerJoin(recipeRuns, eq(recipeRuns.id, recipeOutcomes.runId)).where(eq(recipeRuns.commonsId, f.tripId))).length, 0);
    const [trip] = await f.database.db.select().from(commons).where(eq(commons.id, f.tripId)); assert.equal(trip.startsOn, null); assert.equal(trip.locationName, null);
    await assert.rejects(adoptRecipeAdvice(f.tripId, f.runId, { ...command, commandId: randomUUID() }, f.options), CommandConflictError);
  } finally { await f.cleanup(); }
});

test("cross-round needs approval is atomic, private, scoped, and stale source or audience blocks application", { skip }, async () => {
  const f = await fixture();
  try {
    await f.start(); const first = await f.publish(); await f.respond(first, true); await f.close(first.id); await f.revise();
    let d = await f.detail(); assert.equal(d.advice?.action, "resolve_constraints"); assert.ok(d.advice?.proposedConfiguration);
    await adoptRecipeAdvice(f.tripId, f.runId, { commandId: randomUUID(), expectedDraftVersion: d.draft.version, evidenceFingerprint: d.connectedEvidence!.fingerprint, sourcePollIds: [first.id] }, f.options);
    const final = await f.publish(); await f.respond(final); await f.close(final.id); d = await f.detail();
    const selected = d.alternatives[0], need = d.advice!.constraints.find(need => need.source.pollId === first.id)!;
    assert.ok(need); assert.equal(d.advice?.action, "resolve_constraints");
    const body = { commandId: randomUUID(), pollId: final.id, evidenceFingerprint: d.evidenceFingerprint, connectedEvidenceFingerprint: d.connectedEvidence!.fingerprint,
      alternativeId: selected.id, uncertaintyAcknowledged: true, priorNeedResolutions: [{ pollId: need.source.pollId, responseId: need.source.responseId, questionId: need.source.questionId, resolution: "The selected option includes a private room with an own bed" }] };
    await assert.rejects(approveRecipeOutcome(f.tripId, f.runId, { ...body, priorNeedResolutions: [] }, f.options), /each earlier stated need/);
    await assert.rejects(approveRecipeOutcome(f.tripId, f.runId, { ...body, priorNeedResolutions: [...body.priorNeedResolutions, ...body.priorNeedResolutions] }, f.options), /once/);
    await assert.rejects(approveRecipeOutcome(f.tripId, f.runId, { ...body, priorNeedResolutions: [{ ...body.priorNeedResolutions[0], pollId: randomUUID() }] }, f.options), /another run/);
    await assert.rejects(approveRecipeOutcome(f.tripId, f.runId, { ...body, connectedEvidenceFingerprint: "0".repeat(64) }, f.options), /changed/);
    assert.equal((await f.database.db.select().from(pollDecisions).where(eq(pollDecisions.pollId, final.id))).length, 0, "failed attempts leave no approval");
    const approved = await approveRecipeOutcome(f.tripId, f.runId, body, f.options);
    assert.deepEqual(await approveRecipeOutcome(f.tripId, f.runId, body, f.options), approved);
    const [decision] = await f.database.db.select().from(pollDecisions).where(eq(pollDecisions.pollId, final.id));
    assert.match(JSON.stringify(decision.evidence.recipeConnected), /Own bed/); assert.doesNotMatch(decision.summary, /Own bed|private room/i);
    const publicResult = await getCommonsPollDetail(f.tripId, final.id, { ...f.options, actorPersonId: f.participant });
    assert.doesNotMatch(JSON.stringify(publicResult.decision), /Own bed|private room|priorNeedResolutions|recipeConnected/i);
    d = await f.detail(); assert.equal(d.advice?.constraints.length, 0, "same selected outcome and unchanged evidence resolve earlier needs");
    const apply = { commandId: randomUUID(), outcomeId: approved.outcomeId, expected: d.trip, applyDates: true, applyLocation: true };
    await f.database.db.update(memberships).set({ status: "invited" }).where(and(eq(memberships.commonsId, f.tripId), eq(memberships.personId, f.participant)));
    await assert.rejects(applyRecipeOutcome(f.tripId, f.runId, apply, f.options), /changed after approval/);
    await f.database.db.update(memberships).set({ status: "active" }).where(and(eq(memberships.commonsId, f.tripId), eq(memberships.personId, f.participant)));
    await f.database.db.update(polls).set({ status: "revoked" }).where(eq(polls.id, first.id));
    await assert.rejects(applyRecipeOutcome(f.tripId, f.runId, apply, f.options), /changed after approval/, "revoking a relied-on source invalidates application");
    await f.database.db.update(polls).set({ status: "closed" }).where(eq(polls.id, first.id));
    const [response] = await f.database.db.select().from(pollResponses).where(and(eq(pollResponses.pollId, first.id), eq(pollResponses.respondentPersonId, f.participant)));
    const answers = structuredClone(response.answers); answers.find(answer => answer.context?.kind === "need")!.context!.text = "Own room now required";
    await f.database.db.update(pollResponses).set({ answers, updatedAt: new Date() }).where(eq(pollResponses.id, response.id));
    await assert.rejects(applyRecipeOutcome(f.tripId, f.runId, apply, f.options), /changed after approval/);
    const [trip] = await f.database.db.select().from(commons).where(eq(commons.id, f.tripId)); assert.equal(trip.startsOn, null); assert.equal(trip.locationName, null);
    const [outcome] = await f.database.db.select().from(recipeOutcomes).where(eq(recipeOutcomes.id, approved.outcomeId)); assert.equal(outcome.status, "approved");
  } finally { await f.cleanup(); }
});

test("closed secret recipe evidence never reveals named answers or private needs", { skip }, async () => {
  const f = await fixture();
  try {
    await f.start(); const poll = await f.publish(); await f.respond(poll, true); await f.close(poll.id);
    // Exercise an existing persisted secret ballot, including a legacy private context that must remain hidden.
    await f.database.db.update(polls).set({ ballotMode: "secret" }).where(eq(polls.id, poll.id));
    const d = await f.detail(), source = d.connectedEvidence!.sources[0];
    assert.equal(source.ballotMode, "secret"); assert.equal(source.status, "closed"); assert.deepEqual(source.responses, []); assert.deepEqual(source.resolvedNeeds, []);
    assert.equal(source.hiddenResponseCount, 2); assert.ok(source.responseFingerprint);
    assert.doesNotMatch(JSON.stringify(source), /Own bed|Advice Participant|Advice Organizer|optionResponses|respondentPersonId/i);
    assert.deepEqual(d.notes, []); assert.equal(d.summary, null); assert.deepEqual(d.advice?.constraints, []);
    assert.ok(d.advice?.unknowns.some(text => text.includes("stay unattributed")));
    assert.ok(d.advice?.facts.every(fact => fact.yesPersonIds.length === 0 && !fact.worksForEveryoneAsked));
    const original = d.connectedEvidence!.fingerprint;
    const [response] = await f.database.db.select().from(pollResponses).where(and(eq(pollResponses.pollId, poll.id), eq(pollResponses.respondentPersonId, f.participant)));
    await f.database.db.update(pollResponses).set({ respondentName: "Different recorded name", updatedAt: new Date() }).where(eq(pollResponses.id, response.id));
    const next = await f.detail(); assert.notEqual(next.connectedEvidence!.fingerprint, original); assert.notEqual(next.connectedEvidence!.sources[0].responseFingerprint, source.responseFingerprint);
    assert.deepEqual(next.connectedEvidence!.sources[0].responses, []);
    await f.revise();
    const privateDraft = await f.detail();
    const alternatives = dates().map((date, index) => ({ ...date, place: index ? "Denver" : "Portland" }));
    await saveRecipeInputs(f.tripId, f.runId, { commandId: randomUUID(), expectedDraftVersion: privateDraft.draft.version,
      configuration: { version: 2, blocks: [{ id: randomUUID(), type: "combination", prompt: "Which date-and-place options work?", required: true, options: alternatives }] } }, f.options);
    const final = await f.publish(); await f.respond(final); await f.close(final.id);
    const ready = await f.detail();
    assert.equal(ready.advice?.action, "review_outcome", "prior secret evidence never permanently vetoes a fresh transparent combination");
    assert.deepEqual(ready.advice?.constraints, [], "secret contexts cannot generate cross-round named need payloads");
    assert.ok(ready.advice?.unknowns.some(text => text.includes("stay unattributed")));
    const result = await approveRecipeOutcome(f.tripId, f.runId, { commandId: randomUUID(), pollId: final.id, evidenceFingerprint: ready.evidenceFingerprint,
      connectedEvidenceFingerprint: ready.connectedEvidence!.fingerprint, alternativeId: ready.alternatives[0].id, uncertaintyAcknowledged: true }, f.options);
    await applyRecipeOutcome(f.tripId, f.runId, { commandId: randomUUID(), outcomeId: result.outcomeId, expected: ready.trip, applyDates: true, applyLocation: true }, f.options);
    const applied = await f.detail(); assert.equal(applied.stage, "applied"); assert.equal(applied.advice?.constraints.length, 0);
    assert.deepEqual(applied.connectedEvidence!.sources[0].responses, []);
  } finally { await f.cleanup(); }
});
