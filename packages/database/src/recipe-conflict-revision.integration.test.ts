import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { datesLocationQuestions, type DatesLocationAlternative, type DatesLocationRunDetail, type RecipeRunDetail } from "@commons/contracts";
import { createDatabase } from "./client";
import { listCoordinatorGoals, operateCoordinatorGoal } from "./coordinator-goal-repository";
import { listCommonsPollDrafts } from "./poll-draft-repository";
import { getCommonsPollDetail, submitPublicPollResponseByPublicId, updateCommonsPollStatus } from "./poll-repository";
import { applyRecipeOutcome, approveRecipeOutcome, getRecipeRun, publishRecipeRound, reviseRecipeRound, saveRecipeAlternatives, startDatesLocationRun } from "./recipe-run-repository";
import { commons, memberships, people } from "./schema";

/*
 * BR-03 goal journey with no Coordinator in the loop: objective, a shared round, conflicting answers, a closed round that
 * does NOT resolve the goal, a revised round that carries no votes and counts silence as nothing, an explicit organizer
 * decision, goal acceptance, and a separate exact-scope Plan update. Every step is a direct command; none needs a
 * conversation, research or model call.
 */
const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
const asDates = (detail: RecipeRunDetail): DatesLocationRunDetail => { assert.equal(detail.recipe, "dates_location"); return detail as DatesLocationRunDetail; };
const alt = (startsOn: string, endsOn: string, place: string): DatesLocationAlternative => ({ id: randomUUID(), startsOn, endsOn, place });

test("conflicting answers leave the goal open; a revised round starts clean; the organizer decides; Plan changes separately", { skip }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname), "Disposable local database only");
  const database = createDatabase(url);
  const event = randomUUID(), org = randomUUID(), ana = randomUUID(), ben = randomUUID(), cy = randomUUID();
  const as = (actorPersonId: string) => ({ databaseUrl: url, actorPersonId });
  await database.db.insert(people).values([org, ana, ben, cy].map((id, index) => ({ id, displayName: ["Olive Organizer", "Ana", "Ben", "Cy"][index], authUserId: id })));
  await database.db.insert(commons).values({ id: event, slug: event, name: "Spring trip", createdByPersonId: org, timezone: "America/Denver", startsOn: "2027-04-01", endsOn: "2027-04-03", locationName: "Undecided", locationNames: ["Undecided"] });
  await database.db.insert(memberships).values([{ commonsId: event, personId: org, role: "organizer", status: "active" }, ...[ana, ben, cy].map(personId => ({ commonsId: event, personId, role: "member" as const, status: "active" as const }))]);
  try {
    const napa = alt("2027-05-07", "2027-05-09", "Napa"), sonoma = alt("2027-05-14", "2027-05-16", "Sonoma"), paso = alt("2027-05-21", "2027-05-23", "Paso Robles");
    const runId = randomUUID(), draftId = randomUUID();
    const started = await startDatesLocationRun(event, { commandId: randomUUID(), runId, draftId, recipe: "dates_location", alternatives: [napa, sonoma] }, { ...as(org), createPlanningGoal: true });
    const goalId = started.goalId!;
    const [draft] = await listCommonsPollDrafts(event, as(org), draftId);
    const published = await publishRecipeRound(event, runId, { commandId: randomUUID(), expectedDraftVersion: draft.version, access: "invitees" }, as(org));
    const first = await getCommonsPollDetail(event, published.pollId, as(org));
    const found = datesLocationQuestions(first.questions)!;
    const answer = (poll: { publicId: string }, questions: NonNullable<ReturnType<typeof datesLocationQuestions>>, personId: string, name: string, acceptable: string[], preferred: string | null) =>
      submitPublicPollResponseByPublicId(poll.publicId, { respondentName: name, expectedResponseUpdatedAt: null, answers: [{ questionId: questions.acceptable.id, optionIds: acceptable, text: null }, { questionId: questions.preferred!.id, optionIds: preferred ? [preferred] : [], text: null }] }, url, { authUserId: personId, email: null });

    // Ana and Ben conflict; Cy and the organizer say nothing.
    await answer(first, found, ana, "Ana", [napa.id], napa.id);
    await answer(first, found, ben, "Ben", [sonoma.id], sonoma.id);
    await updateCommonsPollStatus(event, first.id, { commandId: randomUUID(), status: "closed" }, as(org));
    let detail = asDates(await getRecipeRun(event, runId, as(org)));
    assert.equal(detail.stage, "decide");
    assert.ok(detail.summary!.rows.every(row => !row.worksForAllWhoAnswered), "no option works for everyone who answered");
    assert.ok(detail.summary!.awaiting.includes("Cy"), "silence is listed, not counted as agreement");
    let goal = (await listCoordinatorGoals(event, as(org))).goals.find(item => item.goalId === goalId)!;
    assert.notEqual(goal.lifecycle, "completed", "closing the poll and hearing from some people does not resolve the goal");
    assert.equal(detail.trip.startsOn, "2027-04-01", "nothing changed in the trip");

    // The organizer chooses to revise: a new round in the same run, history kept, no carried votes.
    const closedDraft = (await listCommonsPollDrafts(event, as(org), draftId))[0];
    const revision = await reviseRecipeRound(event, runId, { commandId: randomUUID(), expectedDraftVersion: closedDraft.version }, as(org));
    const revisedDraft = (await listCommonsPollDrafts(event, as(org), revision.draftId))[0];
    await saveRecipeAlternatives(event, runId, { commandId: randomUUID(), expectedDraftVersion: revisedDraft.version, alternatives: [napa, paso] }, as(org));
    const [saved] = await listCommonsPollDrafts(event, as(org), revision.draftId);
    const second = await publishRecipeRound(event, runId, { commandId: randomUUID(), expectedDraftVersion: saved.version, access: "invitees" }, as(org));
    assert.notEqual(second.pollId, published.pollId);
    detail = asDates(await getRecipeRun(event, runId, as(org)));
    assert.equal(detail.summary!.respondedCount, 0, "no votes carry across the changed choices");
    assert.equal(detail.summary!.awaiting.length, 4, "everyone is asked again, including those who answered the earlier round");
    assert.equal(detail.history.length, 1);
    assert.equal(detail.history[0].responseCount, 2, "the earlier round and its answers stay as history");
    const oldPoll = await getCommonsPollDetail(event, first.id, as(org));
    assert.equal(oldPoll.responses.length, 2);

    // Round two: Ana and Ben agree on Napa, Cy is still silent. Silence is not agreement, so the organizer decides explicitly.
    const secondPoll = await getCommonsPollDetail(event, second.pollId, as(org));
    const found2 = datesLocationQuestions(secondPoll.questions)!;
    const napa2 = found2.acceptable.options.find(option => option.alternative?.place === "Napa")!;
    await answer(secondPoll, found2, ana, "Ana", [napa2.id], napa2.id);
    await answer(secondPoll, found2, ben, "Ben", [napa2.id], null);
    await updateCommonsPollStatus(event, secondPoll.id, { commandId: randomUUID(), status: "closed" }, as(org));
    detail = asDates(await getRecipeRun(event, runId, as(org)));
    const row = detail.summary!.rows.find(item => item.alternative.place === "Napa")!;
    assert.equal(row.worksForAllWhoAnswered, true);
    assert.equal(row.worksForEveryoneAsked, false, "silence is not agreement");
    assert.equal((await listCoordinatorGoals(event, as(org))).goals.find(item => item.goalId === goalId)!.lifecycle !== "completed", true);

    const outcome = await approveRecipeOutcome(event, runId, { commandId: randomUUID(), pollId: secondPoll.id, evidenceFingerprint: detail.evidenceFingerprint!, connectedEvidenceFingerprint: detail.connectedEvidence?.fingerprint, priorNeedResolutions: [], alternativeId: row.alternative.id, exceptions: ["Cy and the organizer have not answered"], needResolutions: [], uncertaintyAcknowledged: true as const }, as(org));
    goal = (await listCoordinatorGoals(event, as(org))).goals.find(item => item.goalId === goalId)!;
    assert.notEqual(goal.lifecycle, "completed", "recording a decision on the artifact is not goal completion");
    const accepted = await operateCoordinatorGoal(event, { op: "accept_outcome", commandId: randomUUID(), goalId, expectedRevision: goal.revision, outcomeId: outcome.outcomeId }, as(org));
    assert.equal(accepted.goal.lifecycle, "completed");
    detail = asDates(await getRecipeRun(event, runId, as(org)));
    assert.deepEqual(detail.trip, { startsOn: "2027-04-01", endsOn: "2027-04-03", locationNames: ["Undecided"] }, "completing the goal does not update the Plan");

    // The Plan update is its own explicit, exact-scope command: dates only here, the place is left alone.
    await applyRecipeOutcome(event, runId, { commandId: randomUUID(), outcomeId: outcome.outcomeId as string, expected: detail.trip, applyDates: true, applyLocation: false }, as(org));
    const [trip] = await database.db.select().from(commons).where(eq(commons.id, event));
    assert.deepEqual([trip.startsOn, trip.endsOn, trip.locationName], ["2027-05-07", "2027-05-09", "Undecided"]);
  } finally {
    await database.db.delete(commons).where(inArray(commons.id, [event]));
    await database.db.delete(people).where(inArray(people.id, [org, ana, ben, cy]));
    await database.close();
  }
});
