import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { alternativesFromQuestions, datesLocationQuestions, type DatesLocationAlternative, type DatesLocationRunDetail, type RecipeRunDetail } from "@commons/contracts";
import { createDatabase } from "./client";
import { CommandAccessError } from "./event-command";
import { listCoordinatorGoals, operateCoordinatorGoal } from "./coordinator-goal-repository";
import { listCommonsPollDrafts } from "./poll-draft-repository";
import { getCommonsPollDetail, submitPublicPollResponseByPublicId, updateCommonsPollStatus, PollRepositoryError } from "./poll-repository";
import { applyRecipeOutcome, approveRecipeOutcome, getRecipeRun, listRecipeRuns, RecipeRunError, publishRecipeRound, reviseRecipeRound, saveRecipeAlternatives, startDatesLocationRun, setRecipeDraftArchived, assertPlanningGoalOutcome } from "./recipe-run-repository";
import { auditEvents, commons, memberships, people, pollDecisions, pollDrafts, polls, recipeOutcomes, recipeRuns } from "./schema";

const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
const asDates = (detail: RecipeRunDetail): DatesLocationRunDetail => { assert.equal(detail.recipe, "dates_location"); return detail as DatesLocationRunDetail; };
const alt = (startsOn: string, endsOn: string, place: string): DatesLocationAlternative => ({ id: randomUUID(), startsOn, endsOn, place });

async function fixture(url: string) {
  const database = createDatabase(url);
  const event = randomUUID(), other = randomUUID(), org = randomUUID(), org2 = randomUUID(), ana = randomUUID(), ben = randomUUID(), cy = randomUUID();
  await database.db.insert(people).values([org, org2, ana, ben, cy].map((id, index) => ({ id, displayName: ["Olive Organizer", "Otto Organizer", "Ana", "Ben", "Cy"][index], authUserId: id })));
  await database.db.insert(commons).values([{ id: event, slug: event, name: "Wine country weekend", createdByPersonId: org, timezone: "America/Los_Angeles", startsOn: "2026-11-05", endsOn: "2026-11-07", locationName: "Undecided", locationNames: ["Undecided"] },
    { id: other, slug: other, name: "Another trip", createdByPersonId: org2, timezone: "America/Denver" }]);
  await database.db.insert(memberships).values([
    { commonsId: event, personId: org, role: "organizer", status: "active" }, { commonsId: event, personId: org2, role: "organizer", status: "active" },
    ...[ana, ben, cy].map(personId => ({ commonsId: event, personId, role: "member" as const, status: "active" as const })),
    { commonsId: other, personId: org2, role: "organizer", status: "active" }]);
  const cleanup = async () => { await database.db.delete(commons).where(inArray(commons.id, [event, other])); await database.db.delete(people).where(inArray(people.id, [org, org2, ana, ben, cy])); await database.close(); };
  return { database, event, other, org, org2, ana, ben, cy, cleanup, as: (actorPersonId: string) => ({ databaseUrl: url, actorPersonId }) };
}

test("dates and location: start → share → collect → close → approve → apply, with retries and stale guards", { skip }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname), "Disposable local database only");
  const f = await fixture(url);
  try {
    const napa = alt("2026-11-12", "2026-11-14", "Napa"), sonoma = alt("2026-11-19", "2026-11-21", "Sonoma"), paso = alt("2026-11-12", "2026-11-14", "Paso Robles");
    const runId = randomUUID(), draftId = randomUUID(), commandId = randomUUID();
    const start = { commandId, runId, draftId, recipe: "dates_location" as const, alternatives: [napa, sonoma] };

    // Authority: a participant cannot start a run or see its draft.
    await assert.rejects(startDatesLocationRun(f.event, { ...start, commandId: randomUUID(), runId: randomUUID(), draftId: randomUUID() }, f.as(f.ana)), CommandAccessError);
    assert.equal((await database(f).select().from(recipeRuns)).filter(run => run.commonsId === f.event).length, 0);

    // Start is idempotent: a retry creates no second run, draft or receipt.
    const started = await startDatesLocationRun(f.event, start, { ...f.as(f.org), createPlanningGoal: true });
    assert.ok(started.goalId);
    assert.deepEqual(await startDatesLocationRun(f.event, start, { ...f.as(f.org), createPlanningGoal: true }), started);
    const goalBefore = (await listCoordinatorGoals(f.event, f.as(f.org))).goals[0];
    assert.equal(goalBefore.goalId, started.goalId);
    assert.equal(goalBefore.kind, "planning");
    assert.equal(goalBefore.steps[0].refId, runId);
    await assert.rejects(operateCoordinatorGoal(f.other, { op: "start", commandId: randomUUID(), kind: "planning", title: "Cross trip", goal: "No access", workflowRunId: runId }, f.as(f.org2)));
    assert.equal((await database(f).select().from(recipeRuns).where(eq(recipeRuns.commonsId, f.event))).length, 1);
    assert.equal((await database(f).select().from(pollDrafts).where(eq(pollDrafts.runId, runId))).length, 1);
    assert.equal((await listCommonsPollDrafts(f.event, f.as(f.ana))).length, 0, "participants never see recipe drafts");
    const second = (await listCommonsPollDrafts(f.event, f.as(f.org2))).find(item => item.id === draftId);
    assert.ok(second, "another organizer can resume the shared draft");
    assert.equal(second.data.workflow?.key, "trip_feasibility", "the run is pinned to the active recipe version");

    // Reuse of a command id for different content is a conflict, not an overwrite.
    await assert.rejects(startDatesLocationRun(f.event, { ...start, alternatives: [napa, paso] }, f.as(f.org)));

    // Draft edits use the saved version; a stale tab cannot overwrite.
    const edit = await saveRecipeAlternatives(f.event, runId, { commandId: randomUUID(), expectedDraftVersion: 1, alternatives: [napa, sonoma, paso] }, f.as(f.org2));
    assert.equal(edit.draftVersion, 2);
    await assert.rejects(saveRecipeAlternatives(f.event, runId, { commandId: randomUUID(), expectedDraftVersion: 1, alternatives: [napa, paso] }, f.as(f.org)));

    // Cross-trip leakage: the other trip's organizer cannot read or change this run.
    await assert.rejects(getRecipeRun(f.other, runId, f.as(f.org2)), RecipeRunError);
    await assert.rejects(getRecipeRun(f.event, runId, f.as(f.ana)), CommandAccessError);

    // Publish the saved draft exactly as stored. The server builds the request, so a client cannot alter the questions; retries are safe.
    const [draft] = await listCommonsPollDrafts(f.event, f.as(f.org), draftId);
    assert.deepEqual(alternativesFromQuestions(draft.data.questions).map(item => item.place), ["Napa", "Sonoma", "Paso Robles"]);
    await assert.rejects(publishRecipeRound(f.event, runId, { commandId: randomUUID(), expectedDraftVersion: draft.version, access: "invitees" }, f.as(f.ana)), CommandAccessError);
    await assert.rejects(publishRecipeRound(f.event, runId, { commandId: randomUUID(), expectedDraftVersion: draft.version - 1, access: "invitees" }, f.as(f.org)), "a stale draft version cannot be published");
    const publishCommand = { commandId: randomUUID(), expectedDraftVersion: draft.version, access: "invitees" as const };
    const published0 = await publishRecipeRound(f.event, runId, publishCommand, f.as(f.org));
    assert.deepEqual(await publishRecipeRound(f.event, runId, publishCommand, f.as(f.org)), published0, "retry does not publish twice");
    assert.equal((await database(f).select().from(polls).where(eq(polls.commonsId, f.event))).length, 1);
    const poll = await getCommonsPollDetail(f.event, published0.pollId, f.as(f.org));
    const snapshot = JSON.stringify((await database(f).select().from(polls).where(eq(polls.id, poll.id)))[0].questions);
    let detail = asDates(await getRecipeRun(f.event, runId, f.as(f.org)));
    assert.equal(detail.stage, "shared");
    assert.equal(detail.summary?.askedCount, 5, "invitees are everyone active in the trip");

    // Collect: Ana and Ben answer; Cy stays silent. The organizers are also invitees and have not answered.
    const found = datesLocationQuestions(poll.questions)!;
    const neither = found.acceptable.options.find(option => option.exclusive)!.id;
    const answer = (personId: string, name: string, acceptable: string[], preferred: string | null, extra: object = {}) => submitPublicPollResponseByPublicId(poll.publicId, { respondentName: name, expectedResponseUpdatedAt: null,
      answers: [{ questionId: found.acceptable.id, optionIds: acceptable, text: null, ...extra }, { questionId: found.preferred!.id, optionIds: preferred ? [preferred] : [], text: null }] }, url, { authUserId: personId, email: null });
    await answer(f.ana, "Ana", [napa.id, sonoma.id], napa.id);
    await answer(f.ben, "Ben", [napa.id], null, { context: { kind: "need", text: "Needs two beds in one room" } });
    await assert.rejects(answer(f.cy, "Cy", [napa.id, neither], null), PollRepositoryError, "neither cannot be combined with an option");
    detail = asDates(await getRecipeRun(f.event, runId, f.as(f.org)));
    assert.equal(detail.stage, "collecting");
    assert.deepEqual(detail.summary?.awaiting.sort(), ["Cy", "Olive Organizer", "Otto Organizer"]);
    const napaRow = detail.summary!.rows.find(row => row.alternative.id === napa.id)!;
    assert.deepEqual(napaRow.acceptedBy.sort(), ["Ana", "Ben"]); assert.equal(napaRow.worksForAllWhoAnswered, true); assert.equal(napaRow.worksForEveryoneAsked, false);
    assert.equal(detail.summary!.rows.find(row => row.alternative.id === sonoma.id)!.worksForAllWhoAnswered, false);
    assert.equal(detail.evidenceFingerprint, null, "no approval evidence while voting is open");
    assert.deepEqual(detail.notes.map(note => [note.respondentName, note.kind]), [["Ben", "need"]]);

    // Approval needs a closed round.
    const approval = (patch: object = {}) => ({ commandId: randomUUID(), pollId: poll.id, evidenceFingerprint: detail.evidenceFingerprint ?? "0".repeat(64), alternativeId: napa.id, exceptions: ["Cy has not answered"], needResolutions: [], uncertaintyAcknowledged: true as const, ...patch });
    await assert.rejects(approveRecipeOutcome(f.event, runId, approval(), f.as(f.org)), (error: unknown) => error instanceof RecipeRunError && error.code === "not_ready");
    await updateCommonsPollStatus(f.event, poll.id, { commandId: randomUUID(), status: "closed" }, f.as(f.org));
    detail = asDates(await getRecipeRun(f.event, runId, f.as(f.org)));
    assert.equal(detail.stage, "decide"); assert.match(detail.evidenceFingerprint ?? "", /^[0-9a-f]{64}$/);

    // Guards: participant, unexplained need, stale evidence, option that was never asked.
    await assert.rejects(approveRecipeOutcome(f.event, runId, approval({ evidenceFingerprint: detail.evidenceFingerprint }), f.as(f.ana)), CommandAccessError);
    await assert.rejects(approveRecipeOutcome(f.event, runId, approval({ evidenceFingerprint: detail.evidenceFingerprint }), f.as(f.org)), /stated need/);
    const need = detail.notes.find(note => note.kind === "need")!;
    const resolutions = [{ responseId: need.responseId, questionId: need.questionId, resolution: "Napa inn has a twin room; confirm when booking" }];
    await assert.rejects(approveRecipeOutcome(f.event, runId, approval({ evidenceFingerprint: "f".repeat(64), needResolutions: resolutions }), f.as(f.org)), /changed/);
    await assert.rejects(approveRecipeOutcome(f.event, runId, approval({ evidenceFingerprint: detail.evidenceFingerprint, needResolutions: resolutions, alternativeId: randomUUID() }), f.as(f.org)), PollRepositoryError);
    assert.equal((await database(f).select().from(recipeOutcomes).where(eq(recipeOutcomes.runId, runId))).length, 0, "failed approvals leave nothing behind");

    // Approve once; the retry returns the same outcome, a different command cannot approve the round twice.
    const good = approval({ evidenceFingerprint: detail.evidenceFingerprint, needResolutions: resolutions });
    const outcome = await approveRecipeOutcome(f.event, runId, good, f.as(f.org));
    assert.equal((await listCoordinatorGoals(f.event, f.as(f.org))).goals[0].lifecycle, "waiting_for_approval", "approval of the artifact alone does not claim the goal is satisfied");
    const changed = await operateCoordinatorGoal(f.event, { op: "edit_goal", commandId: randomUUID(), goalId: started.goalId, expectedRevision: 1, goal: "Choose a strong fit with explicitly reviewed exceptions", completionCriterion: "Review missing travelers and the bed requirement before accepting this fit" }, f.as(f.org));
    assert.equal(changed.goal.revision, 2);
    assert.equal(changed.goal.lifecycle, "waiting_for_approval");
    const accept = { op: "accept_outcome", commandId: randomUUID(), goalId: started.goalId, expectedRevision: 2, outcomeId: outcome.outcomeId };
    await assert.rejects(operateCoordinatorGoal(f.event, { ...accept, expectedRevision: 1 }, f.as(f.org)));
    await assert.rejects(operateCoordinatorGoal(f.event, accept, f.as(f.org2)));
    await assert.rejects(operateCoordinatorGoal(f.event, { ...accept, outcomeId: randomUUID() }, f.as(f.org)));
    const complete = await operateCoordinatorGoal(f.event, accept, f.as(f.org));
    assert.equal(complete.goal.lifecycle, "completed");
    assert.equal(complete.goal.outcome?.receipt?.object, outcome.outcomeId);
    assert.equal(complete.goal.outcomeRevision, 2);
    assert.equal((await operateCoordinatorGoal(f.event, accept, f.as(f.org))).replayed, true);
    assert.equal((await getRecipeRun(f.event, runId, f.as(f.org))).trip.startsOn, "2026-11-05", "finishing a Goal does not apply dates");
    assert.deepEqual(await approveRecipeOutcome(f.event, runId, good, f.as(f.org)), outcome);
    await assert.rejects(approveRecipeOutcome(f.event, runId, { ...good, commandId: randomUUID() }, f.as(f.org2)), PollRepositoryError);
    assert.equal((await database(f).select().from(pollDecisions).where(eq(pollDecisions.pollId, poll.id))).length, 1);
    detail = asDates(await getRecipeRun(f.event, runId, f.as(f.org)));
    assert.equal(detail.stage, "decided"); assert.equal((detail.outcome?.result as { place?: string } | undefined)?.place, "Napa");
    assert.deepEqual((detail.outcome?.result as { basis?: unknown } | undefined)?.basis, { respondedCount: 2, askedCount: 5, awaitingCount: 3, acceptedCount: 2, preferredCount: 1 });
    assert.deepEqual(detail.trip, { startsOn: "2026-11-05", endsOn: "2026-11-07", locationNames: ["Undecided"] }, "approval alone never changes the trip");

    // Apply: explicit targets, optimistic trip check, replay-safe.
    const expected = detail.trip, outcomeId = outcome.outcomeId as string;
    await assert.rejects(applyRecipeOutcome(f.event, runId, { commandId: randomUUID(), outcomeId, expected, applyDates: true, applyLocation: true }, f.as(f.ana)), CommandAccessError);
    await assert.rejects(applyRecipeOutcome(f.event, runId, { commandId: randomUUID(), outcomeId, expected: { ...expected, endsOn: "2026-11-08" }, applyDates: true, applyLocation: true }, f.as(f.org)), (error: unknown) => error instanceof RecipeRunError && error.code === "trip_changed");
    const apply = { commandId: randomUUID(), outcomeId, expected, applyDates: true, applyLocation: false };
    await applyRecipeOutcome(f.event, runId, apply, f.as(f.org));
    await applyRecipeOutcome(f.event, runId, apply, f.as(f.org));
    let trip = (await database(f).select().from(commons).where(eq(commons.id, f.event)))[0];
    assert.deepEqual([trip.startsOn, trip.endsOn, trip.locationName], ["2026-11-12", "2026-11-14", "Undecided"], "only the chosen target changed");
    await assert.rejects(applyRecipeOutcome(f.event, runId, { ...apply, commandId: randomUUID(), expected: detail.trip }, f.as(f.org)), RecipeRunError, "an applied outcome cannot be applied again");
    assert.equal((await database(f).select().from(auditEvents).where(eq(auditEvents.commonsId, f.event))).filter(row => row.action === "commons.details_updated").length, 1);
    detail = asDates(await getRecipeRun(f.event, runId, f.as(f.org)));
    assert.equal(detail.stage, "applied"); assert.deepEqual(detail.outcome?.stale, []);
    await database(f).update(commons).set({ locationName: "Changed elsewhere", locationNames: ["Changed elsewhere"] }).where(eq(commons.id, f.event));
    await assert.rejects(f.database.db.transaction(tx => assertPlanningGoalOutcome(tx, f.event, runId, outcomeId)), "normalizing an applied date receipt must not hide unrelated location drift");
    await database(f).update(commons).set({ locationName: "Undecided", locationNames: ["Undecided"] }).where(eq(commons.id, f.event));
    const reopened = await operateCoordinatorGoal(f.event, { op: "reopen", commandId: randomUUID(), goalId: started.goalId, expectedRevision: 2, note: "Review the applied outcome too" }, f.as(f.org));
    assert.equal(reopened.goal.lifecycle, "waiting_for_approval");
    assert.equal((await operateCoordinatorGoal(f.event, { ...accept, commandId: randomUUID(), expectedRevision: 3 }, f.as(f.org))).goal.lifecycle, "completed", "applying first must not strand goal completion");
    assert.equal(JSON.stringify((await database(f).select().from(polls).where(eq(polls.id, poll.id)))[0].questions), snapshot, "published snapshot is unchanged by approval and application");

    // A later trip edit surfaces as drift on only the fields the outcome owns; history is not rewritten.
    await database(f).update(commons).set({ endsOn: "2026-11-15" }).where(eq(commons.id, f.event));
    await operateCoordinatorGoal(f.event, { op: "reopen", commandId: randomUUID(), goalId: started.goalId, expectedRevision: 3, note: "Check changed dates" }, f.as(f.org));
    await assert.rejects(operateCoordinatorGoal(f.event, { ...accept, commandId: randomUUID(), expectedRevision: 4 }, f.as(f.org)), "a stale applied outcome cannot finish the goal");
    detail = asDates(await getRecipeRun(f.event, runId, f.as(f.org)));
    assert.deepEqual(detail.outcome?.stale.map(item => item.field), ["dates"]); assert.equal(detail.outcome?.status, "applied");

    // Revising the round keeps it inside the same run and preserves the earlier evidence and outcome.
    const published = (await listCommonsPollDrafts(f.event, f.as(f.org), draftId))[0];
    const replacement = await reviseRecipeRound(f.event, runId, { commandId: randomUUID(), expectedDraftVersion: published.version }, f.as(f.org));
    assert.equal((await database(f).select().from(pollDrafts).where(eq(pollDrafts.id, replacement.draftId)))[0].runId, runId);
    detail = asDates(await getRecipeRun(f.event, runId, f.as(f.org)));
    assert.equal(detail.stage, "draft"); assert.equal(detail.history.length, 1); assert.equal(detail.history[0].outcomeStatus, "applied");
    const runs = await listRecipeRuns(f.event, f.as(f.org));
    assert.equal(runs.length, 1); assert.equal(runs[0].rounds, 2);
    trip = (await database(f).select().from(commons).where(eq(commons.id, f.event)))[0];
    assert.equal(trip.startsOn, "2026-11-12");
  } finally { await f.cleanup(); }
});

function database(f: { database: ReturnType<typeof createDatabase> }) { return f.database.db; }

test("planning goals: deleting drafts releases capacity and restore preserves the Goal identity", { skip }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(url).hostname, "127.0.0.1");
  const f = await fixture(url);
  try {
    let last: { runId: string; goalId: string } | null = null;
    for (let i = 0; i < 7; i++) {
      const result = await startDatesLocationRun(f.event, { commandId: randomUUID(), runId: randomUUID(), draftId: randomUUID(), recipe: "dates_location" }, { ...f.as(f.org), createPlanningGoal: true });
      assert.ok(result.goalId);
      last = { runId: result.runId, goalId: result.goalId };
      await setRecipeDraftArchived(f.event, result.runId, { commandId: randomUUID(), expectedDraftVersion: 1, archived: true }, f.as(f.org2));
      const goal = (await listCoordinatorGoals(f.event, f.as(f.org))).goals.find(item => item.goalId === result.goalId)!;
      assert.equal(goal.lifecycle, "cancelled");
      await assert.rejects(operateCoordinatorGoal(f.event, { op: "reopen", commandId: randomUUID(), goalId: goal.goalId, expectedRevision: goal.revision }, f.as(f.org)));
    }
    await setRecipeDraftArchived(f.event, last!.runId, { commandId: randomUUID(), expectedDraftVersion: 2, archived: false }, f.as(f.org2));
    const restored = (await listCoordinatorGoals(f.event, f.as(f.org))).goals.find(item => item.goalId === last!.goalId)!;
    assert.equal(restored.lifecycle, "waiting_for_approval");
    assert.equal(restored.revision, 3);
    assert.equal(restored.steps[0].refId, last!.runId);
    await operateCoordinatorGoal(f.event, { op: "cancel", commandId: randomUUID(), goalId: restored.goalId, expectedRevision: 3 }, f.as(f.org));
    await setRecipeDraftArchived(f.event, last!.runId, { commandId: randomUUID(), expectedDraftVersion: 3, archived: true }, f.as(f.org2));
    await assert.rejects(operateCoordinatorGoal(f.event, { op: "reopen", commandId: randomUUID(), goalId: restored.goalId, expectedRevision: 3 }, f.as(f.org)), "manual cancellation before archive must not bypass the source fence");
  } finally { await f.cleanup(); }
});
