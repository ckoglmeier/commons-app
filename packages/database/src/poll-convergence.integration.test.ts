import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { datesLocationQuestions, type DatesLocationConfiguration, type DatesLocationRunDetail, type PollAnswer } from "@commons/contracts";
import { createDatabase } from "./client";
import { listCommonsPollDrafts } from "./poll-draft-repository";
import { createCommonsPoll, getCommonsPollDetail, getPublicPollByPublicId, submitPublicPollResponseByPublicId, updateCommonsPollStatus } from "./poll-repository";
import { approveRecipeOutcome, getRecipeRun, publishRecipeRound, reviseRecipeRound, saveRecipeInputs, startRecipeRun } from "./recipe-run-repository";
import { commons, memberships, people, pollDeliveries } from "./schema";

const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
async function fixture() {
  const url = process.env.TEST_DATABASE_URL!;
  const parsed = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) && parsed.pathname.endsWith("_test"), "Disposable loopback *_test database only");
  const database = createDatabase(url), event = randomUUID(), org = randomUUID(), member = randomUUID(), second = randomUUID();
  await database.db.insert(people).values([org, member, second].map((id, index) => ({ id, displayName: ["Synthetic Organizer", "Synthetic Ana", "Synthetic Ben"][index], authUserId: id })));
  await database.db.insert(commons).values({ id: event, slug: event, name: "Synthetic convergence", timezone: "UTC", createdByPersonId: org });
  await database.db.insert(memberships).values([org, member, second].map(id => ({ commonsId: event, personId: id, status: "active" as const, role: id === org ? "organizer" as const : "member" as const })));
  return { database, url, event, org, member, second, options: { databaseUrl: url, actorPersonId: org }, cleanup: async () => { await database.db.delete(commons).where(eq(commons.id, event)); await database.db.delete(people).where(inArray(people.id, [org, member, second])); await database.close(); } };
}
const places = ["Montreal", "Denver", "Miami", "Portland"].map(place => ({ id: randomUUID(), place }));
const configuration: DatesLocationConfiguration = { version: 2, blocks: [
  { id: randomUUID(), type: "location", scale: "interest", prompt: "Interest in each place?", required: true, options: places },
  { id: randomUUID(), type: "ranking", dimension: "location", prompt: "Rank all places", required: true, options: places },
  { id: randomUUID(), type: "allocation", dimension: "location", prompt: "Allocate ten points", required: true, options: places },
  { id: randomUUID(), type: "text", prompt: "Departure airport?", required: false, options: [] },
] };
function typedAnswers(): PollAnswer[] {
  return configuration.blocks.flatMap(block => block.type === "text" ? [] : [{ questionId: block.id, optionIds: [], text: null,
    ...(block.type === "location" ? { optionResponses: places.map((option, index) => ({ optionId: option.id, value: ["not_interested", "could_go", "interested", "top_choice"][index] as "not_interested" | "could_go" | "interested" | "top_choice" })), context: { kind: "need" as const, text: "Synthetic step-free room need" } }
      : block.type === "ranking" ? { rankedOptionIds: places.map(option => option.id).reverse() } : { allocations: places.map((option, index) => ({ optionId: option.id, points: [0, 3, 7, 0][index] })) }),
  }]);
}

test("v2 typed recipe persists create/save/publish/respond/edit/read/close with guards and no trip mutation", { skip }, async () => {
  const f = await fixture();
  try {
    const runId = randomUUID(), draftId = randomUUID();
    await startRecipeRun(f.event, { commandId: randomUUID(), runId, draftId, recipe: "dates_location" }, f.options);
    await saveRecipeInputs(f.event, runId, { commandId: randomUUID(), expectedDraftVersion: 1, configuration }, f.options);
    await assert.rejects(saveRecipeInputs(f.event, runId, { commandId: randomUUID(), expectedDraftVersion: 1, configuration }, f.options));
    const draft = (await listCommonsPollDrafts(f.event, f.options, draftId))[0];
    assert.deepEqual(draft.data.recipeConfiguration, configuration);
    const publication = { commandId: randomUUID(), expectedDraftVersion: draft.version, access: "invitees" as const };
    const published = await publishRecipeRound(f.event, runId, publication, f.options);
    assert.deepEqual(await publishRecipeRound(f.event, runId, publication, f.options), published);
    const poll = await getCommonsPollDetail(f.event, published.pollId, f.options), originalSnapshot = JSON.stringify(poll.questions);
    const answers = typedAnswers(), viewer = { authUserId: f.member, email: null };
    const saved = await submitPublicPollResponseByPublicId(poll.publicId, { expectedResponseUpdatedAt: null, answers }, f.url, viewer);
    assert.deepEqual(saved.poll?.ownResponse?.answers, answers);
    await assert.rejects(submitPublicPollResponseByPublicId(poll.publicId, { expectedResponseUpdatedAt: null, answers: answers.map(answer => answer.allocations ? { ...answer, allocations: answer.allocations.map((row, index) => ({ ...row, points: [0, 2, 7, 0][index] })) } : answer) }, f.url, viewer));
    const abstained = answers.map(answer => answer.questionId === configuration.blocks[1].id || answer.questionId === configuration.blocks[2].id ? { questionId: answer.questionId, optionIds: [], text: null, abstained: true as const } : answer);
    const edited = await submitPublicPollResponseByPublicId(poll.publicId, { expectedResponseUpdatedAt: saved.poll?.ownResponse?.updatedAt, answers: abstained }, f.url, viewer);
    assert.equal(edited.poll?.responseCount, 1);
    assert.deepEqual(edited.poll?.ownResponse?.answers, abstained);
    await assert.rejects(submitPublicPollResponseByPublicId(poll.publicId, { expectedResponseUpdatedAt: saved.poll?.ownResponse?.updatedAt, answers }, f.url, viewer), /changed|saved|review/i);
    const publicPoll = await getPublicPollByPublicId(poll.publicId, f.url, viewer);
    assert.deepEqual(publicPoll?.ownResponse?.answers, abstained);
    const memberDetail = await getCommonsPollDetail(f.event, poll.id, { ...f.options, actorPersonId: f.second });
    assert.equal(memberDetail.responses[0].answers?.[0].context, undefined, "private needs are server filtered");
    const read = await getCommonsPollDetail(f.event, poll.id, f.options);
    assert.equal(read.responses[0].answers?.[0].context?.kind, "need");
    assert.equal(read.aggregates[0].optionResponseCounts?.[places[1].id].could_go, 1);
    assert.equal(read.aggregates[1].abstainedCount, 1);
    assert.equal(read.aggregates[2].pointTotals?.[places[2].id], 0);
    await updateCommonsPollStatus(f.event, poll.id, { commandId: randomUUID(), status: "closed" }, f.options);
    const run = await getRecipeRun(f.event, runId, f.options) as DatesLocationRunDetail;
    assert.equal(run.exploratory, true); assert.equal(run.summary, null); assert.equal(run.outcome, null);
    await assert.rejects(approveRecipeOutcome(f.event, runId, { commandId: randomUUID(), pollId: poll.id, evidenceFingerprint: run.evidenceFingerprint, alternativeId: places[2].id, uncertaintyAcknowledged: true }, f.options), /options.*asked|feasibility|exploratory/i);
    assert.deepEqual(run.trip, { startsOn: null, endsOn: null, locationNames: [] });
    const replacement = await reviseRecipeRound(f.event, runId, { commandId: randomUUID(), expectedDraftVersion: draft.version }, f.options);
    const replacementDraft = (await listCommonsPollDrafts(f.event, f.options, replacement.draftId))[0];
    assert.deepEqual(replacementDraft.data.recipeConfiguration, configuration);
    assert.equal((await getRecipeRun(f.event, runId, f.options)).poll, null, "replacement draft has no carried votes");
    assert.equal(JSON.stringify((await getCommonsPollDetail(f.event, poll.id, f.options)).questions), originalSnapshot);
    assert.equal((await f.database.db.select().from(pollDeliveries).where(eq(pollDeliveries.pollId, poll.id))).length, 0);
  } finally { await f.cleanup(); }
});

test("nine v2 combinations plus ranking approve only explicit feasibility evidence", { skip }, async () => {
  const f = await fixture();
  try {
    const alternatives = Array.from({ length: 9 }, (_, index) => ({ id: randomUUID(), startsOn: `2027-05-${10 + index}`, endsOn: `2027-05-${11 + index}`, place: "Denver" }));
    const combination = { id: randomUUID(), type: "combination" as const, prompt: "Select every combination that works", required: true, options: alternatives };
    const rank = { id: randomUUID(), type: "ranking" as const, dimension: "combination" as const, prompt: "Rank all combinations", required: true, options: alternatives };
    const runId = randomUUID();
    await startRecipeRun(f.event, { commandId: randomUUID(), runId, draftId: randomUUID(), recipe: "dates_location", configuration: { version: 2, blocks: [combination, rank] } }, f.options);
    const pub = await publishRecipeRound(f.event, runId, { commandId: randomUUID(), expectedDraftVersion: 1, access: "invitees" }, f.options);
    const poll = await getCommonsPollDetail(f.event, pub.pollId, f.options);
    const acceptable = datesLocationQuestions(poll.questions)!.acceptable;
    await submitPublicPollResponseByPublicId(poll.publicId, { expectedResponseUpdatedAt: null, answers: [{ questionId: acceptable.id, optionIds: [alternatives[0].id], text: null }, { questionId: rank.id, optionIds: [], text: null, rankedOptionIds: alternatives.map(option => option.id).reverse() }] }, f.url, { authUserId: f.member, email: null });
    await updateCommonsPollStatus(f.event, poll.id, { commandId: randomUUID(), status: "closed" }, f.options);
    const run = await getRecipeRun(f.event, runId, f.options) as DatesLocationRunDetail;
    assert.equal(run.exploratory, false);
    assert.equal(run.summary?.rows.at(-1)?.acceptedBy.length, 0, "first ranked option is never counted as accepted");
    assert.equal(run.summary?.rows.at(-1)?.preferredBy.length, 0, "ranking is never translated into a legacy preference count");
    const result = await approveRecipeOutcome(f.event, runId, { commandId: randomUUID(), pollId: poll.id, evidenceFingerprint: run.evidenceFingerprint, alternativeId: alternatives[0].id, uncertaintyAcknowledged: true }, f.options);
    const decided = await getRecipeRun(f.event, runId, f.options) as DatesLocationRunDetail;
    assert.equal(decided.outcome?.id, result.outcomeId);
    assert.equal(decided.outcome?.result.kind === "dates_location" ? decided.outcome.result.basis.acceptedCount : null, 1);
    assert.equal(decided.outcome?.result.kind === "dates_location" ? decided.outcome.result.basis.preferredCount : null, 0);
    assert.deepEqual(decided.trip, run.trip, "approval does not change the trip");
  } finally { await f.cleanup(); }
});

test("secret typed poll hides attribution and aggregates until closed, then exposes correct typed totals", { skip }, async () => {
  const f = await fixture();
  try {
    const optionIds = places.map(option => option.id), question = { id: randomUUID(), kind: "allocation", totalPoints: 10, prompt: "Preferences", required: true, options: places.map(option => ({ id: option.id, label: option.place, place: { name: option.place } })) };
    const poll = await createCommonsPoll(f.event, { commandId: randomUUID(), title: "Secret synthetic preference", ballotMode: "secret", audience: { personIds: [f.member], guestEmails: [] }, questions: [question] }, f.options);
    await submitPublicPollResponseByPublicId(poll.publicId, { expectedResponseUpdatedAt: null, answers: [{ questionId: question.id, optionIds: [], text: null, allocations: optionIds.map((optionId, index) => ({ optionId, points: [1, 2, 3, 4][index] })) }] }, f.url, { authUserId: f.member, email: null });
    const hidden = await getCommonsPollDetail(f.event, poll.id, f.options);
    assert.equal(hidden.resultsVisible, false); assert.deepEqual(hidden.aggregates, []); assert.equal(hidden.responses[0].answers, null);
    await updateCommonsPollStatus(f.event, poll.id, { commandId: randomUUID(), status: "closed" }, f.options);
    const closed = await getCommonsPollDetail(f.event, poll.id, f.options);
    assert.deepEqual(closed.aggregates[0].pointTotals, Object.fromEntries(optionIds.map((id, index) => [id, index + 1])));
    assert.equal(closed.responses[0].answers, null);
  } finally { await f.cleanup(); }
});
