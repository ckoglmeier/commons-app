import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { buildFoodPollData, SaveFoodSchema, summarizeFoodResponses } from "@commons/contracts";
import { createDatabase } from "./client";
import { commons, memberships, people, pollDrafts, pollResponses, recipeOutcomes, coordinatorGoals } from "./schema";
import { listCoordinatorGoals, operateCoordinatorGoal } from "./coordinator-goal-repository";
import { saveCommonsPollDraft } from "./poll-draft-repository";
import { startRecipeRun, getRecipeRun, saveRecipeInputs, publishRecipeRound, approveRecipeOutcome, reviseRecipeRound } from "./recipe-run-repository";
import { loadCoordinatorTripContext } from "./coordinator-context-repository";
import { getCommonsPollDetail, getPublicPollByPublicId, pollAnswersForViewer, submitPublicPollResponseByPublicId, updateCommonsPollStatus } from "./poll-repository";

test("food questions remain optional, stable and organizer-only", () => {
  const data = buildFoodPollData({});
  assert.equal(data.questions.length, 3);
  assert.ok(data.questions.every(q => !q.required && q.organizerOnly));
  assert.deepEqual(buildFoodPollData({ previous: data }).questions, data.questions);
  const answers = [{ questionId: data.questions[0].id, text: "Peanut allergy", optionIds: [] }];
  assert.deepEqual(pollAnswersForViewer(answers, "transparent", false, data.questions), []);
  assert.deepEqual(pollAnswersForViewer(answers, "transparent", true, data.questions), answers);
});

test("food editing preserves wording, identities and order, and enforces private written questions", () => {
  const previous = buildFoodPollData({});
  const questions = previous.questions.map(q => ({ id: q.id, prompt: `${q.prompt} Edited`, required: true, foodField: "notes" as const })).reverse();
  const data = buildFoodPollData({ previous, intro: "Custom introduction", questions });
  assert.equal(data.intro, "Custom introduction");
  assert.deepEqual(data.questions.map(q => q.id), questions.map(q => q.id));
  assert.ok(data.questions.every(q => q.organizerOnly && q.required));
  assert.deepEqual(buildFoodPollData({ previous: data, title: "New title" }).questions, data.questions);
  assert.equal(buildFoodPollData({ previous: data }).intro, data.intro);
  const command = { commandId: randomUUID(), expectedDraftVersion: 1 };
  for (const invalid of [[], [questions[0], questions[0]], [{ ...questions[0], organizerOnly: false }], [{ ...questions[0], prompt: " " }]]) {
    assert.equal(SaveFoodSchema.safeParse({ ...command, questions: invalid }).success, false);
  }
  const summary = summarizeFoodResponses(data.questions, [{ id: randomUUID(), name: "Synthetic", answers: data.questions.map((q, index) => ({ questionId: q.id, text: `Answer ${index}`, optionIds: [] })) }]);
  for (const index of [0, 1, 2]) assert.match(summary.entries[0].notes!, new RegExp(`Answer ${index}`));
});

test("food lifecycle shares through existing commands without leaking dietary answers", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(url).hostname, "127.0.0.1");
  assert.ok(new URL(url).pathname.endsWith("_test"));
  const db = createDatabase(url), event = randomUUID(), org = randomUUID(), member = randomUUID();
  const as = (actorPersonId: string) => ({ databaseUrl: url, actorPersonId });
  try {
    await db.db.insert(people).values([{ id: org, displayName: "Food Organizer", authUserId: org }, { id: member, displayName: "Food Member", authUserId: member }]);
    await db.db.insert(commons).values({ id: event, slug: event, name: "Synthetic food trip", createdByPersonId: org, timezone: "America/Denver" });
    await db.db.insert(memberships).values([{ commonsId: event, personId: org, role: "organizer", status: "active" }, { commonsId: event, personId: member, role: "member", status: "active" }]);
    for (const recipe of ["dates_location", "lodging"] as const) {
      const blank = { commandId: randomUUID(), runId: randomUUID(), draftId: randomUUID(), recipe };
      await startRecipeRun(event, blank, as(org));
      const draft = await getRecipeRun(event, blank.runId, as(org));
      assert.equal(draft.stage, "draft");
      await assert.rejects(publishRecipeRound(event, draft.id, { commandId: randomUUID(), expectedDraftVersion: draft.draft.version, access: "link" }, as(org)), "Incomplete drafts cannot be published");
    }
    const input = { commandId: randomUUID(), runId: randomUUID(), draftId: randomUUID(), recipe: "food_preferences" };
    await assert.rejects(startRecipeRun(event, input, as(member)));
    await startRecipeRun(event, input, as(org));
    await startRecipeRun(event, input, as(org));
    let run = await getRecipeRun(event, input.runId, as(org));
    assert.equal(run.recipe, "food_preferences");
    const edited = { commandId: randomUUID(), expectedDraftVersion: run.draft.version, intro: "Edited introduction", questions: run.participantPreview!.questions.map(q => ({ id: q.id, prompt: `${q.prompt} Updated`, required: false, foodField: q.kind === "text" ? q.foodField! : "notes" as const })).reverse() };
    await assert.rejects(saveRecipeInputs(event, run.id, edited, as(member)));
    await saveRecipeInputs(event, run.id, edited, as(org));
    await assert.rejects(saveRecipeInputs(event, run.id, { ...edited, commandId: randomUUID() }, as(org)), "Stale question edits must not overwrite the saved draft");
    run = await getRecipeRun(event, run.id, as(org));
    assert.deepEqual(run.participantPreview!.questions.map(q => q.id), edited.questions.map(q => q.id));
    assert.equal(run.participantPreview!.intro, edited.intro);
    const [savedDraft] = await db.db.select().from(pollDrafts).where(eq(pollDrafts.id, run.draft.id));
    const unsafe = { ...savedDraft.data, questions: savedDraft.data.questions.map(q => ({ ...q, organizerOnly: false })) };
    await assert.rejects(saveCommonsPollDraft(event, { id: savedDraft.id, commandId: randomUUID(), expectedVersion: savedDraft.version, data: unsafe }, as(org)), "Generic draft editing cannot make food answers public");
    await db.db.update(pollDrafts).set({ data: unsafe }).where(eq(pollDrafts.id, savedDraft.id));
    await assert.rejects(publishRecipeRound(event, run.id, { commandId: randomUUID(), expectedDraftVersion: run.draft.version, access: "link" }, as(org)), "Canonical publication rejects legacy unsafe food drafts");
    await db.db.update(pollDrafts).set({ data: savedDraft.data }).where(eq(pollDrafts.id, savedDraft.id));
    const published = await publishRecipeRound(event, run.id, { commandId: randomUUID(), expectedDraftVersion: run.draft.version, access: "link" }, as(org));
    const poll = await getCommonsPollDetail(event, published.pollId, as(org));
    await submitPublicPollResponseByPublicId(published.publicId, { respondentName: "Synthetic guest", answers: poll.questions.map((q, i) => ({ questionId: q.id, optionIds: [], text: ["Peanut allergy", "Italian food", "Early dinner"][i] })) }, url);
    const visible = await getCommonsPollDetail(event, published.pollId, as(member));
    assert.deepEqual(visible.responses[0].answers, []);
    assert.deepEqual(visible.aggregates, []);
    const publicPoll = await getPublicPollByPublicId(published.publicId, url);
    assert.ok(!JSON.stringify(publicPoll).includes("Peanut allergy"));
    assert.equal((await getCommonsPollDetail(event, published.pollId, as(org))).responses[0].answers?.[0].text, "Peanut allergy");
    await assert.rejects(saveRecipeInputs(event, run.id, { ...edited, commandId: randomUUID(), expectedDraftVersion: run.draft.version }, as(org)), "Published questions are immutable");
    const before = await loadCoordinatorTripContext(event, as(org));
    assert.equal(before.foodPreferences.length, 1);
    assert.equal(before.foodPreferences[0].value.pollId, published.pollId);
    assert.match(JSON.stringify(before.foodPreferences), /Peanut allergy/);
    assert.equal((await db.db.select().from(recipeOutcomes).where(eq(recipeOutcomes.runId, run.id))).length, 0, "Reading food context does not approve an outcome");
    await assert.rejects(loadCoordinatorTripContext(event, as(member)));
    const [response] = await db.db.select().from(pollResponses).where(eq(pollResponses.pollId, published.pollId));
    await db.db.update(pollResponses).set({ answers: response.answers.map((a, index) => index ? a : { ...a, text: "Updated dietary answer" }), updatedAt: new Date() }).where(eq(pollResponses.id, response.id));
    const after = await loadCoordinatorTripContext(event, as(org));
    assert.notEqual(after.foodPreferences[0].version, before.foodPreferences[0].version);
    assert.match(JSON.stringify(after.foodPreferences), /Updated dietary answer/);
    assert.doesNotMatch(JSON.stringify(after.foodPreferences), /Peanut allergy/);
    await assert.rejects(getRecipeRun(event, run.id, as(member)));
    await updateCommonsPollStatus(event, published.pollId, { commandId: randomUUID(), status: "closed" }, as(org));
    run = await getRecipeRun(event, run.id, as(org));
    await approveRecipeOutcome(event, run.id, { commandId: randomUUID(), pollId: published.pollId, evidenceFingerprint: run.evidenceFingerprint, uncertaintyAcknowledged: true }, as(org));
    run = await getRecipeRun(event, run.id, as(org));
    assert.equal(run.stage, "decided");
    assert.equal(run.outcome?.result.kind, "food_preferences");
    assert.ok(!JSON.stringify(await getCommonsPollDetail(event, published.pollId, as(member))).includes("Peanut allergy"));
    await reviseRecipeRound(event, run.id, { commandId: randomUUID(), expectedDraftVersion: run.draft.version }, as(org));
    const revised = await getRecipeRun(event, run.id, as(org));
    assert.equal(revised.stage, "draft");
    assert.deepEqual(revised.participantPreview!.questions, run.participantPreview!.questions);
    const historical = (await loadCoordinatorTripContext(event, as(org))).foodPreferences;
    assert.equal(historical.length, 1);
    assert.equal(historical[0].value.roundState, "earlier"); assert.equal(historical[0].value.replacementState, "private_draft");
    assert.match(JSON.stringify(historical), /Updated dietary answer/);
    assert.equal(revised.recipe, "food_preferences");
    if (revised.recipe !== "food_preferences") throw new Error("Expected food Goal");
    assert.equal(revised.summary, null, "Historical answers never become new votes");
    assert.match(JSON.stringify(revised.earlierFoodAnswers), /Updated dietary answer/);
    const next = await publishRecipeRound(event, revised.id, { commandId: randomUUID(), expectedDraftVersion: revised.draft.version, access: "link" }, as(org));
    const zero = (await loadCoordinatorTripContext(event, as(org))).foodPreferences;
    assert.equal(zero.find(source => source.value.pollId === next.pollId)!.value.responseCount, 0);
    assert.match(JSON.stringify(zero.find(source => source.value.pollId === published.pollId)), /Updated dietary answer/);
    await submitPublicPollResponseByPublicId(next.publicId, { respondentName: "A different guest", answers: revised.participantPreview!.questions.map(q => ({ questionId: q.id, optionIds: [], text: "" })) }, url);
    const partial = (await loadCoordinatorTripContext(event, as(org))).foodPreferences;
    assert.equal(partial.find(source => source.value.pollId === next.pollId)!.value.roundState, "current");
    assert.equal(partial.find(source => source.value.pollId === published.pollId)!.value.roundState, "earlier");
    assert.match(JSON.stringify(partial), /Updated dietary answer/, "Partial new answers do not erase known earlier restrictions");
    for (const publicId of [published.publicId, next.publicId]) assert.doesNotMatch(JSON.stringify(await getPublicPollByPublicId(publicId, url)), /Updated dietary answer|Peanut allergy|Italian food/);
    for (let index = 0; index < 21; index++) {
      const latest = await getRecipeRun(event, run.id, as(org));
      await reviseRecipeRound(event, latest.id, { commandId: randomUUID(), expectedDraftVersion: latest.draft.version }, as(org));
      const emptyDraft = await getRecipeRun(event, run.id, as(org));
      await publishRecipeRound(event, emptyDraft.id, { commandId: randomUUID(), expectedDraftVersion: emptyDraft.draft.version, access: "link" }, as(org));
    }
    const bounded = (await loadCoordinatorTripContext(event, as(org))).foodPreferences;
    assert.equal(bounded.length, 20); assert.ok(bounded.every(source => source.value.historyIncomplete));
    assert.match(JSON.stringify(bounded.find(source => source.value.pollId === published.pollId)), /Updated dietary answer/, "Unanswered revision floods must not displace known reports before empty rounds");
  } finally {
    await db.db.delete(commons).where(eq(commons.id, event));
    await db.db.delete(people).where(eq(people.id, org));
    await db.db.delete(people).where(eq(people.id, member));
    await db.close();
  }
});

test("closing answered food collection completes once, empty close does not, and revision resumes the same Goal", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL!; assert.equal(new URL(url).hostname, "127.0.0.1"); assert.ok(new URL(url).pathname.endsWith("_test"));
  const db = createDatabase(url), event = randomUUID(), org = randomUUID(), runId = randomUUID(), options = { databaseUrl: url, actorPersonId: org };
  try {
    await db.db.insert(people).values({ id: org, displayName: "Food test organizer", authUserId: org });
    await db.db.insert(commons).values({ id: event, slug: event, name: "Food collection test", createdByPersonId: org, timezone: "America/Denver" });
    await db.db.insert(memberships).values({ commonsId: event, personId: org, role: "organizer", status: "active" });
    await startRecipeRun(event, { commandId: randomUUID(), runId, draftId: randomUUID(), recipe: "food_preferences" }, { ...options, createPlanningGoal: true });
    const goal = async () => (await listCoordinatorGoals(event, options)).goals.find(g => g.planning?.runId === runId)!;
    const publish = async () => { const run = await getRecipeRun(event, runId, options); return publishRecipeRound(event, runId, { commandId: randomUUID(), expectedDraftVersion: run.draft.version, access: "link" }, options); };
    const close = (pollId: string) => updateCommonsPollStatus(event, pollId, { commandId: randomUUID(), status: "closed" }, options);
    const revise = async () => { const run = await getRecipeRun(event, runId, options); return reviseRecipeRound(event, runId, { commandId: randomUUID(), expectedDraftVersion: run.draft.version }, options); };
    let published = await publish();
    const waiting = (await goal()).planning;
    assert.equal(waiting?.label, "Waiting for food preferences");
    assert.equal(waiting?.nextAction, "Share the poll link to collect food preferences.", "An open empty round still asks for the link to be shared");
    await close(published.pollId);
    const empty = await goal();
    assert.notEqual(empty.lifecycle, "completed", "Zero answers cannot complete collection");
    assert.equal(empty.planning?.label, "Voting closed · no answers");
    assert.equal(empty.planning?.nextAction, "No answers were received. Start another round to ask again.", "A closed poll's link collects nothing");
    assert.equal(empty.planning?.action, "view_round");
    await revise(); published = await publish();
    const answer = async () => { const run = await getRecipeRun(event, runId, options); await submitPublicPollResponseByPublicId(published.publicId, { respondentName: "Fictional guest", answers: run.participantPreview!.questions.map((q,i) => ({ questionId: q.id, optionIds: [], text: i ? "" : "Peanut allergy" })) }, url); };
    await answer(); assert.notEqual((await goal()).lifecycle, "completed", "Responses alone cannot close collection");
    await close(published.pollId); const completed = await goal();
    assert.equal(completed.lifecycle, "completed"); assert.equal(completed.outcome?.kind, "poll"); assert.match(completed.outcome!.detail ?? "", /No meal arrangement/);
    assert.equal((await listCoordinatorGoals(event, options)).reports.filter(r => r.goalId === completed.goalId && r.kind === "completed" && !r.superseded).length, 1);
    assert.equal((await db.db.select().from(recipeOutcomes).where(eq(recipeOutcomes.runId, runId))).length, 0, "No approval or Plan mutation is fabricated");
    await updateCommonsPollStatus(event, published.pollId, { commandId: randomUUID(), status: "open" }, options);
    const reopenedCollection = await goal(); assert.notEqual(reopenedCollection.lifecycle, "completed"); assert.equal(reopenedCollection.outcome, null);
    await close(published.pollId); assert.equal((await goal()).lifecycle, "completed");
    await revise(); const resumed = await goal();
    assert.equal(resumed.goalId, completed.goalId); assert.ok(resumed.revision > completed.revision); assert.notEqual(resumed.lifecycle, "completed"); assert.equal(resumed.outcome, null);
    assert.equal((await getRecipeRun(event, runId, options)).stage, "draft");
    published = await publish(); await answer(); await close(published.pollId); const again = await goal(); assert.equal(again.lifecycle, "completed");
    await operateCoordinatorGoal(event, { op: "reopen", commandId: randomUUID(), goalId: again.goalId, expectedRevision: again.revision, note: "Collect one more round" }, options);
    assert.notEqual((await goal()).lifecycle, "completed", "A reopened Goal cannot inherit the prior close");
    assert.equal((await db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.id, again.goalId))).length, 1);
    assert.match(JSON.stringify((await loadCoordinatorTripContext(event, options)).foodPreferences), /Peanut allergy/, "Completed and reopened Goals retain reported needs");
    const cancelling = await goal(); await operateCoordinatorGoal(event, { op: "cancel", commandId: randomUUID(), goalId: cancelling.goalId, expectedRevision: cancelling.revision }, options);
    await updateCommonsPollStatus(event, published.pollId, { commandId: randomUUID(), status: "open" }, options); await close(published.pollId);
    assert.equal((await goal()).lifecycle, "cancelled", "Poll status actions cannot resurrect canceled Goals");
  } finally { await db.db.delete(commons).where(eq(commons.id, event)); await db.db.delete(people).where(eq(people.id, org)); await db.close(); }
});
