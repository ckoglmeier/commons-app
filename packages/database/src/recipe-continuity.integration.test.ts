import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { attendanceQuestions, datesLocationQuestions, lodgingQuestions, type LodgingRunDetail, type LodgingPropertyInput } from "@commons/contracts";
import { createDatabase } from "./client";
import { CommandAccessError, CommandConflictError } from "./event-command";
import { getCommonsPollDetail, getPublicPollByPublicId, submitPublicPollResponseByPublicId, updateCommonsPollStatus, createCommonsPoll } from "./poll-repository";
import { saveCommonsPollDraft } from "./poll-draft-repository";
import { updateCommonsDetails } from "./pilot-repository";
import { listCoordinatorGoals, operateCoordinatorGoal } from "./coordinator-goal-repository";
import { startRecipeRun, saveRecipeInputs, getRecipeRun, publishRecipeRound, approveRecipeOutcome, applyRecipeOutcome, reviseRecipeRound } from "./recipe-run-repository";
import { commons, people, memberships, pollDecisions, pollDrafts, recipeOutcomes, recipeRuns } from "./schema";

const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";

test("resume dates → lodging retains sources and needs; six of eight answers, successor history and upstream drift", { skip }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(url).hostname, "127.0.0.1"); assert.ok(new URL(url).pathname.endsWith("_test"));
  const database = createDatabase(url), db = database.db;
  const trip = randomUUID(), ids = Array.from({ length: 8 }, () => randomUUID()), [org, bed, budget, neither] = ids;
  const as = (actorPersonId = org) => ({ databaseUrl: url, actorPersonId });
  await db.insert(people).values(ids.map((id, index) => ({ id, authUserId: id, displayName: ["Organizer", "Bed Need", "Budget Need", "None Fit", "Traveler Four", "Traveler Five", "Missing Six", "Missing Seven"][index] })));
  await db.insert(commons).values({ id: trip, slug: trip, name: "Continuity synthetic", createdByPersonId: org, timezone: "America/Los_Angeles" });
  await db.insert(memberships).values(ids.map(id => ({ commonsId: trip, personId: id, role: id === org ? "organizer" as const : "member" as const, status: "active" as const })));
  try {
    const datesRun = randomUUID(), datesDraft = randomUUID();
    const alternatives = [{ id: randomUUID(), startsOn: "2027-05-07", endsOn: "2027-05-09", place: "Sonoma" }, { id: randomUUID(), startsOn: "2027-05-14", endsOn: "2027-05-16", place: "Napa" }];
    const start = { commandId: randomUUID(), runId: datesRun, draftId: datesDraft, recipe: "dates_location", alternatives };
    await startRecipeRun(trip, start, { ...as(), createPlanningGoal: true }); await startRecipeRun(trip, start, { ...as(), createPlanningGoal: true });
    assert.equal((await listCoordinatorGoals(trip, as())).goals[0].planning!.label, "Drafting");
    const resumed = (await listCoordinatorGoals(trip, { ...as(), now: new Date(Date.now() + 14 * 86400_000) })).goals[0];
    assert.equal(resumed.lifecycle, "waiting_for_approval", "saved human planning work does not expire under a research execution deadline");
    assert.equal(resumed.planning!.runId, datesRun);
    let dates = await getRecipeRun(trip, datesRun, as());
    assert.equal(dates.draft.id, datesDraft); assert.equal((await getRecipeRun(trip, datesRun, as())).draft.version, dates.draft.version);
    const dp = await publishRecipeRound(trip, datesRun, { commandId: randomUUID(), expectedDraftVersion: dates.draft.version, access: "invitees" }, as());
    const dq = datesLocationQuestions((await getCommonsPollDetail(trip, dp.pollId, as())).questions)!;
    await submitPublicPollResponseByPublicId(dp.publicId, { respondentName: "ignored", expectedResponseUpdatedAt: null, answers: [{ questionId: dq.acceptable.id, optionIds: [alternatives[0].id], text: null, context: { kind: "need", text: "Need my own bed; accommodation still to confirm" } }] }, url, { authUserId: bed, email: null });
    assert.equal((await getRecipeRun(trip, datesRun, as())).poll!.id, dp.pollId, "returning to a published round retains identity and answers");
    await updateCommonsPollStatus(trip, dp.pollId, { commandId: randomUUID(), status: "closed" }, as());
    dates = await getRecipeRun(trip, datesRun, as());
    const note = dates.notes[0];
    const chosen = await approveRecipeOutcome(trip, datesRun, { commandId: randomUUID(), pollId: dp.pollId, evidenceFingerprint: dates.evidenceFingerprint, alternativeId: alternatives[0].id, exceptions: ["Sleeping setup remains to confirm"], needResolutions: [{ responseId: note.responseId, questionId: note.questionId, resolution: "Carry the own-bed requirement into lodging; not yet confirmed" }], uncertaintyAcknowledged: true }, as()) as { outcomeId: string };
    await applyRecipeOutcome(trip, datesRun, { commandId: randomUUID(), outcomeId: chosen.outcomeId, expected: dates.trip, applyDates: true, applyLocation: true }, as());
    const properties: LodgingPropertyInput[] = ["House A", "House B"].map((name, index) => ({ id: randomUUID(), name, url: `https://example.com/house-${index}`, description: null, rooms: index ? "Twin rooms" : "Four king rooms", beds: index ? "separate_beds_available" : "king_only", pricing: { basis: "per_person", period: "stay", currency: "USD", minCents: 40000, maxCents: 45000, fees: "unknown" } }));
    const runId = randomUUID(), draftId = randomUUID();
    await startRecipeRun(trip, { commandId: randomUUID(), runId, draftId, recipe: "lodging", properties }, { ...as(), createPlanningGoal: true });
    let stay = await getRecipeRun(trip, runId, as()) as LodgingRunDetail;
    assert.equal(stay.context!.changed, false);
    assert.equal(stay.context!.saved!.sources[0].outcomeId, chosen.outcomeId);
    assert.equal(stay.context!.saved!.sources[0].needs[0].text, note.text);
    assert.match(stay.context!.saved!.sources[0].needs[0].resolution!, /not yet confirmed/);
    assert.equal(stay.context!.saved!.trip.startsOn, alternatives[0].startsOn);
    assert.match(stay.intro!, /May/); assert.equal(stay.context!.saved!.attendance, null);
    await assert.rejects(getRecipeRun(trip, runId, as(bed)), CommandAccessError);

    // A manual refinement and an unrelated context question survive option edits.
    let [draft] = await db.select().from(pollDrafts).where(eq(pollDrafts.id, draftId));
    const extra = { id: randomUUID(), kind: "text" as const, prompt: "Any other requirements?", required: false };
    const manual = { ...draft.data, recipeContext: undefined, intro: "Please pick what works. We will confirm beds before booking.", questions: [...draft.data.questions.map((q, index) => index ? q : { ...q, prompt: "Which houses actually work?" }), extra] };
    const edited = await saveCommonsPollDraft(trip, { id: draftId, commandId: randomUUID(), expectedVersion: draft.version, data: manual }, as());
    stay = await getRecipeRun(trip, runId, as()) as LodgingRunDetail;
    assert.equal(stay.context!.changed, true, "a legacy draft has a visible review/save path before publication");
    const save = { commandId: randomUUID(), expectedDraftVersion: edited.version, title: "Lodging fit", properties, askAboutChildren: false, reviewedContextFingerprint: stay.context!.current.fingerprint };
    await saveRecipeInputs(trip, runId, save, as()); await saveRecipeInputs(trip, runId, save, as());
    [draft] = await db.select().from(pollDrafts).where(eq(pollDrafts.id, draftId));
    assert.equal(draft.data.intro, manual.intro); assert.equal(draft.data.questions[0].prompt, "Which houses actually work?");
    assert.deepEqual(draft.data.questions.at(-1), extra);
    await assert.rejects(saveRecipeInputs(trip, runId, { ...save, commandId: randomUUID() }, as()), CommandConflictError);

    await updateCommonsDetails(trip, { commandId: randomUUID(), title: "Continuity synthetic", startsOn: "2027-05-14", endsOn: "2027-05-16", locationName: "Sonoma", locationNames: ["Sonoma"], balancesDisabled: false }, as());
    stay = await getRecipeRun(trip, runId, as()) as LodgingRunDetail;
    assert.equal(stay.context!.changed, true); assert.equal(stay.context!.saved!.trip.startsOn, "2027-05-07");
    await assert.rejects(publishRecipeRound(trip, runId, { commandId: randomUUID(), expectedDraftVersion: stay.draft.version, access: "invitees" }, as()), CommandConflictError);
    await assert.rejects(createCommonsPoll(trip, { ...draft.data, commandId: randomUUID(), draftId, draftVersion: stay.draft.version, publicationApproval: { approved: true, access: "invitees" } }, as()), CommandConflictError, "direct publication cannot bypass drift review");
    await assert.rejects(saveRecipeInputs(trip, runId, { ...save, commandId: randomUUID(), expectedDraftVersion: stay.draft.version }, as()), /Review the updated context/);
    const refresh = { ...save, commandId: randomUUID(), expectedDraftVersion: stay.draft.version, reviewedContextFingerprint: stay.context!.current.fingerprint, intro: manual.intro };
    await saveRecipeInputs(trip, runId, refresh, as()); await saveRecipeInputs(trip, runId, refresh, as());
    stay = await getRecipeRun(trip, runId, as()) as LodgingRunDetail;
    assert.equal(stay.context!.changed, false); assert.equal(stay.context!.saved!.trip.startsOn, "2027-05-14");
    const pub = { commandId: randomUUID(), expectedDraftVersion: stay.draft.version, access: "invitees" as const };
    const poll = await publishRecipeRound(trip, runId, pub, as()); assert.deepEqual(await publishRecipeRound(trip, runId, pub, as()), poll);
    const changeDates = (startsOn: string, endsOn: string) => updateCommonsDetails(trip, { commandId: randomUUID(), title: "Continuity synthetic", startsOn, endsOn, locationName: "Sonoma", locationNames: ["Sonoma"], balancesDisabled: false }, as());
    await changeDates("2027-05-21", "2027-05-23");
    assert.deepEqual(await publishRecipeRound(trip, runId, pub, as()), poll, "a lost-success retry returns the published identity even after upstream drift");
    await changeDates("2027-05-14", "2027-05-16");
    const publicPoll = await getPublicPollByPublicId(poll.publicId, url, { authUserId: bed, email: null });
    assert.equal(JSON.stringify(publicPoll).includes("Carry the own-bed"), false, "private source resolution never enters publication");
    assert.equal(JSON.stringify(publicPoll).includes("recipeContext"), false);
    const sq = lodgingQuestions((await getCommonsPollDetail(trip, poll.pollId, as())).questions)!;
    for (const person of ids.slice(0, 6)) await submitPublicPollResponseByPublicId(poll.publicId, { respondentName: "ignored", expectedResponseUpdatedAt: null, answers: [
      { questionId: sq.acceptable.id, optionIds: [person === neither ? sq.acceptable.options.find(option => option.exclusive)!.id : properties[0].id], text: null,
        ...(person === budget ? { context: { kind: "need" as const, text: "My total lodging budget is $450 including fees" } } : {}) },
      { questionId: sq.preferred!.id, optionIds: person === neither ? [] : [properties[0].id], text: null },
      { questionId: sq.sleeping!.id, optionIds: [sq.sleeping!.options.find(option => option.sleeping === (person === bed ? "own_bed" : "no_preference"))!.id], text: null },
    ] }, url, { authUserId: person, email: null });
    stay = await getRecipeRun(trip, runId, as()) as LodgingRunDetail;
    assert.equal(stay.summary!.respondedCount, 6); assert.equal(stay.summary!.askedCount, 8);
    assert.deepEqual(stay.summary!.awaiting.sort(), ["Missing Six", "Missing Seven"].sort());
    assert.deepEqual(stay.summary!.neitherBy, ["None Fit"]); assert.match(stay.summary!.rows[0].conflicts[0], /Bed Need/);
    assert.equal(stay.notes[0].kind, "need");
    await updateCommonsPollStatus(trip, poll.pollId, { commandId: randomUUID(), status: "closed" }, as());
    stay = await getRecipeRun(trip, runId, as()) as LodgingRunDetail;
    const decision = { commandId: randomUUID(), pollId: poll.pollId, evidenceFingerprint: stay.evidenceFingerprint,
      optionId: properties[0].id, uncertaintyAcknowledged: true, acknowledgedConflicts: stay.summary!.rows[0].conflicts,
      exceptions: ["PRIVATE condition: confirm individual budget separately"] };
    await assert.rejects(approveRecipeOutcome(trip, runId, decision, as()), /each stated need/);
    const budgetNote = stay.notes[0];
    const approved = { ...decision, commandId: randomUUID(), needResolutions: [{ responseId: budgetNote.responseId, questionId: budgetNote.questionId, resolution: "Confirm fees before booking; budget not yet guaranteed" }] };
    await approveRecipeOutcome(trip, runId, approved, as()); await approveRecipeOutcome(trip, runId, approved, as());
    const visible = await getPublicPollByPublicId(poll.publicId, url, { authUserId: bed, email: null });
    assert.match(visible!.decision!.summary, /preference, not a booking/);
    assert.equal(JSON.stringify(visible).includes("PRIVATE condition"), false);
    assert.equal(JSON.stringify(visible).includes("budget not yet guaranteed"), false);
    const [legacyOutcome] = await db.select().from(recipeOutcomes).where(eq(recipeOutcomes.runId,runId));
    await db.update(pollDecisions).set({ summary: "Chose House A. Exceptions noted: PRIVATE condition: confirm individual budget separately." }).where(eq(pollDecisions.id,legacyOutcome.decisionId));
    const legacyVisible = await getPublicPollByPublicId(poll.publicId,url,{authUserId:org,email:null});
    assert.equal(JSON.stringify(legacyVisible).includes("PRIVATE condition"),false,"older lodging decisions also use the server participant allowlist");
    assert.doesNotMatch(JSON.stringify(await getCommonsPollDetail(trip,poll.pollId,as(neither))),/PRIVATE condition/,"trip results cannot bypass the participant projection");
    assert.match((await getCommonsPollDetail(trip,poll.pollId,as())).decision!.summary,/PRIVATE condition/,"private legacy approval is unchanged");
    stay = await getRecipeRun(trip, runId, as()) as LodgingRunDetail;
    assert.equal(stay.participantDecision!.summary,legacyVisible!.decision!.summary,"the copy recap receives the same safe projection");
    assert.ok(stay.participantDecision); assert.equal(stay.stage, "decided");
    const goal = (await listCoordinatorGoals(trip, as())).goals.find(item => item.planning?.runId === runId)!;
    await operateCoordinatorGoal(trip, { op: "accept_outcome", commandId: randomUUID(), goalId: goal.goalId, expectedRevision: goal.revision, outcomeId: stay.outcome!.id }, as());
    assert.equal((await listCoordinatorGoals(trip, as())).goals.find(item => item.goalId === goal.goalId)!.resultStale, false);
    const attRun = randomUUID();
    await startRecipeRun(trip, { commandId: randomUUID(), runId: attRun, draftId: randomUUID(), recipe: "attendance" }, as());
    const att = await getRecipeRun(trip, attRun, as());
    const attPoll = await publishRecipeRound(trip, attRun, { commandId: randomUUID(), expectedDraftVersion: att.draft.version, access: "invitees" }, as());
    const aq = attendanceQuestions((await getCommonsPollDetail(trip, attPoll.pollId, as())).questions)!;
    await submitPublicPollResponseByPublicId(attPoll.publicId, { expectedResponseUpdatedAt: null, answers: [{ questionId: aq.state.id, optionIds: [aq.state.options.find(item => item.attendance === "in")!.id], text: null }] }, url, { authUserId: org, email: null });
    await updateCommonsPollStatus(trip, attPoll.pollId, { commandId: randomUUID(), status: "closed" }, as());
    const closedAttendance = await getRecipeRun(trip, attRun, as());
    await approveRecipeOutcome(trip, attRun, { commandId: randomUUID(), pollId: attPoll.pollId, evidenceFingerprint: closedAttendance.evidenceFingerprint, uncertaintyAcknowledged: true }, as());
    const afterAttendance = (await listCoordinatorGoals(trip, as())).goals.find(item => item.goalId === goal.goalId)!;
    assert.equal(afterAttendance.lifecycle, "completed"); assert.equal(afterAttendance.resultStale, true, "completion stays historical when a source decision changes");
    const revision = { commandId: randomUUID(), expectedDraftVersion: stay.draft.version };
    await reviseRecipeRound(trip, runId, revision, as()); await reviseRecipeRound(trip, runId, revision, as());
    const successor = await getRecipeRun(trip, runId, as()) as LodgingRunDetail;
    assert.equal(successor.id, runId); assert.notEqual(successor.draft.id, draftId); assert.equal(successor.poll, null);
    assert.equal(successor.history[0].responseCount, 6);
    assert.equal((await getCommonsPollDetail(trip, poll.pollId, as())).responseCount, 6);
    assert.equal((await db.select().from(recipeRuns).where(eq(recipeRuns.commonsId, trip))).length, 3);
  } finally { await db.delete(commons).where(eq(commons.id, trip)); await db.delete(people).where(inArray(people.id, ids)); await database.close(); }
});
