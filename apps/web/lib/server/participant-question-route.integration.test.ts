import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { operateCoordinatorGoal } from "@commons/database";
import { actAs, captureWarnings, databaseTestsEnabled, seedSyntheticTrip, testDatabaseUrl } from "./coordinator-route-harness";
import { registerComponentImportStubs } from "../test-support/hook-harness";

/*
 * Conversation durability lane B through the real route handlers (disposable database, local-development actor). Identity comes only from the session:
 * no route takes a person id. Gate: COMMONS_PARTICIPANT_QUESTIONS_ENABLED. Turning it off stops new questions but keeps a published one answerable.
 */
const skip = !databaseTestsEnabled;
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function routes() {
  registerComponentImportStubs();
  const [goalQuestions, mine, one] = await Promise.all([
    import("../../app/api/v1/commons/[slug]/goals/[goalId]/questions/route"),
    import("../../app/api/v1/commons/[slug]/questions/route"),
    import("../../app/api/v1/commons/[slug]/questions/[questionId]/route"),
  ]);
  return { goalQuestions, mine, one };
}
const json = async (response: Response) => ({ status: response.status, body: await response.json() as Body });
const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("B01-B08 routes: organizer prepares and publishes, the traveler reads and answers, everyone else gets not-found, and the flag stops only new questions", { skip }, async () => {
  const trip = await seedSyntheticTrip();
  const warnings = captureWarnings();
  process.env.COMMONS_PARTICIPANT_QUESTIONS_ENABLED = "true";
  try {
    const r = await routes();
    const goal = (await operateCoordinatorGoal(trip.eventId, { op: "start", commandId: randomUUID(), kind: "plan_action", title: "Coordinate airport transport", goal: "Resolve airport transport for Friday.", completionCriterion: "A reviewed transport plan is saved." }, { databaseUrl: testDatabaseUrl(), actorPersonId: trip.organizerId })).goal;
    const goalCtx = { params: Promise.resolve({ slug: trip.eventId, goalId: goal.goalId }) }, tripCtx = { params: Promise.resolve({ slug: trip.eventId }) };
    actAs(trip.organizerId);
    const listed = await json(await r.goalQuestions.GET(new Request("http://localhost/x"), goalCtx));
    assert.equal(listed.body.enabled, true);
    assert.deepEqual(listed.body.recipients.map((p: Body) => p.name).sort(), ["Robin Synthetic", "Taylor Synthetic"], "names only; the asker is not offered");
    assert.doesNotMatch(JSON.stringify(listed.body.recipients), /@|email|phone/);
    const prepared = await json(await r.goalQuestions.POST(post({ action: "prepare", commandId: randomUUID(), expectedGoalRevision: goal.revision, recipientPersonId: trip.travelerId, purpose: "Arrival time for airport transport", question: "What time do you land on Friday?", expiresInHours: 48 }), goalCtx));
    assert.equal(prepared.status, 200);
    actAs(trip.travelerId);
    assert.deepEqual((await json(await r.mine.GET(new Request("http://localhost/x"), tripCtx))).body.questions, [], "a draft delivers nothing");
    actAs(trip.organizerId);
    // Discard a second, never-published draft through the route (review finding H1): it is gone, and the asker's list keeps only the real one.
    const extra = await json(await r.goalQuestions.POST(post({ action: "prepare", commandId: randomUUID(), expectedGoalRevision: goal.revision, recipientPersonId: trip.coOrganizerId, purpose: "Pickup", question: "Can you drive?", expiresInHours: 24 }), goalCtx));
    const discarded = await json(await r.goalQuestions.POST(post({ action: "cancel", questionId: extra.body.questionId }), goalCtx));
    assert.equal(discarded.status, 200); assert.equal(discarded.body.discarded, true);
    assert.equal((await json(await r.goalQuestions.GET(new Request("http://localhost/x"), goalCtx))).body.questions.length, 1);
    await json(await r.goalQuestions.POST(post({ action: "publish", commandId: randomUUID(), questionId: prepared.body.questionId, expectedVersion: 1 }), goalCtx));
    const oneCtx = { params: Promise.resolve({ slug: trip.eventId, questionId: prepared.body.questionId }) };
    // Not the recipient: the asker, a co-organizer, and an id from nowhere all see the same not-found.
    for (const person of [trip.organizerId, trip.coOrganizerId]) { actAs(person); assert.equal((await r.one.GET(new Request("http://localhost/x"), oneCtx)).status, 404); }
    actAs(trip.travelerId);
    assert.equal((await r.one.GET(new Request("http://localhost/x"), { params: Promise.resolve({ slug: trip.eventId, questionId: randomUUID() }) })).status, 404);
    const read = await json(await r.one.GET(new Request("http://localhost/x"), oneCtx));
    assert.equal(read.body.state, "waiting"); assert.equal(read.body.askedBy, "Casey Synthetic"); assert.deepEqual(read.body.sharedWith, ["Casey Synthetic", "Robin Synthetic"]);
    const submission = { submissionId: randomUUID(), body: "Landing 3:10 PM", expectedAnswerRevision: 0 };
    const receipt = await json(await r.one.POST(post(submission), oneCtx));
    assert.equal(receipt.status, 200); assert.equal(receipt.body.revision, 1);
    assert.equal((await json(await r.one.POST(post(submission), oneCtx))).body.replayed, true);
    const conflict = await json(await r.one.POST(post({ ...submission, body: "Something else" }), oneCtx));
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, "stale");
    actAs(trip.coOrganizerId);
    const audience = await json(await r.goalQuestions.GET(new Request("http://localhost/x"), goalCtx));
    assert.equal(audience.body.questions[0].answer.body, "Landing 3:10 PM", "the task's organizers see only the submitted answer");
    // Flag off: no new questions, but the published one keeps its read/answer disposition and the task keeps the answer.
    process.env.COMMONS_PARTICIPANT_QUESTIONS_ENABLED = "false";
    actAs(trip.organizerId);
    const refused = await json(await r.goalQuestions.POST(post({ action: "prepare", commandId: randomUUID(), expectedGoalRevision: goal.revision, recipientPersonId: trip.travelerId, purpose: "x", question: "Another?", expiresInHours: 24 }), goalCtx));
    assert.equal(refused.status, 403); assert.equal(refused.body.error.code, "unavailable");
    assert.equal((await json(await r.goalQuestions.GET(new Request("http://localhost/x"), goalCtx))).body.questions.length, 1);
    actAs(trip.travelerId);
    const corrected = await json(await r.one.POST(post({ submissionId: randomUUID(), body: "Correction: 5:45 PM", expectedAnswerRevision: 1 }), oneCtx));
    assert.equal(corrected.body.revision, 2);
    // Cancelled by the asker: a fresh submission is refused with a clear closed state; the saved answer stays.
    process.env.COMMONS_PARTICIPANT_QUESTIONS_ENABLED = "true";
    actAs(trip.organizerId);
    await json(await r.goalQuestions.POST(post({ action: "cancel", questionId: prepared.body.questionId }), goalCtx));
    actAs(trip.travelerId);
    const closed = await json(await r.one.POST(post({ submissionId: randomUUID(), body: "late", expectedAnswerRevision: 2 }), oneCtx));
    assert.equal(closed.status, 409); assert.equal(closed.body.error.code, "closed");
    const after = await json(await r.one.GET(new Request("http://localhost/x"), oneCtx));
    assert.equal(after.body.state, "cancelled"); assert.equal(after.body.answer.body, "Correction: 5:45 PM"); assert.equal(after.body.canAnswer, false);
  } finally { delete process.env.COMMONS_PARTICIPANT_QUESTIONS_ENABLED; warnings.restore(); await trip.cleanup(); }
});
