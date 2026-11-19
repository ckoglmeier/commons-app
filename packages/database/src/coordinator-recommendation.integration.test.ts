import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { CommandConflictError } from "./event-command";
import { listCoordinatorRecommendations, saveOperatorPreparedCoordinatorRecommendation } from "./coordinator-recommendation-repository";
import { readPollEvidence } from "./poll-evidence";
import { commons, coordinatorRecommendations, memberships, operatorAuditEvents, people, pollResponses, polls } from "./schema";

test("operator preparation is owner-scoped, audited, idempotent, and marks changed poll evidence stale", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
  const database = createDatabase(url);
  const event = randomUUID(), organizer = randomUUID(), otherOrganizer = randomUUID(), operator = randomUUID(), secondOperator = randomUUID(), pollId = randomUUID();
  try {
    await database.db.insert(people).values([
      { id: organizer, authUserId: organizer, displayName: "Organizer" }, { id: otherOrganizer, authUserId: otherOrganizer, displayName: "Other organizer" }, { id: operator, authUserId: operator, displayName: "Operator" }, { id: secondOperator, authUserId: secondOperator, displayName: "Second operator" },
    ]);
    await database.db.insert(commons).values({ id: event, slug: event, name: "Recommendation QA", createdByPersonId: organizer, timezone: "America/Denver" });
    await database.db.insert(memberships).values([{ commonsId: event, personId: organizer, role: "organizer", status: "active" }, { commonsId: event, personId: otherOrganizer, role: "organizer", status: "active" }]);
    await database.db.insert(polls).values({ id: pollId, commonsId: event, createdByPersonId: organizer, commandId: randomUUID(), title: "Dinner timing", ballotMode: "transparent", status: "closed", audience: null, questions: [{ id: randomUUID(), kind: "text", prompt: "What timing works?", required: false }], shareTokenHash: "test-hash", shareTokenValue: "test-value" });
    const [poll] = await database.db.select().from(polls).where(eq(polls.id, pollId));
    const evidenceFingerprint = (await database.db.transaction(tx => readPollEvidence(tx, poll))).fingerprint;
    const request = { commandId: randomUUID(), expectedVersion: 0, sourcePollId: pollId, evidenceFingerprint, preparedBy: "Commons operator", recommendation: "Use the earlier dinner window.", freshness: "Prepared from the closed poll just now.", uncertainties: ["One traveler did not respond."], openQuestions: ["Confirm the restaurant."], nextAction: "Review a decision before telling the group." };
    await assert.rejects(saveOperatorPreparedCoordinatorRecommendation(event, { ...request, commandId: randomUUID(), expectedVersion: 1 }, { databaseUrl: url, operatorPersonId: operator, organizerPersonId: organizer }), CommandConflictError, "a create must name version zero");
    const saved = await saveOperatorPreparedCoordinatorRecommendation(event, request, { databaseUrl: url, operatorPersonId: operator, organizerPersonId: organizer });
    assert.equal(saved.version, 1);
    assert.equal((await saveOperatorPreparedCoordinatorRecommendation(event, request, { databaseUrl: url, operatorPersonId: operator, organizerPersonId: organizer })).id, saved.id, "the same operator command is replay-safe");
    await assert.rejects(saveOperatorPreparedCoordinatorRecommendation(event, request, { databaseUrl: url, operatorPersonId: secondOperator, organizerPersonId: organizer }), CommandConflictError, "a different operator cannot replay another operator's receipt");
    assert.equal((await listCoordinatorRecommendations(event, { databaseUrl: url, actorPersonId: organizer }))[0].evidenceCurrent, true);
    assert.deepEqual(await listCoordinatorRecommendations(event, { databaseUrl: url, actorPersonId: otherOrganizer }), [], "another organizer cannot see this private owner artifact");
    const revised = await saveOperatorPreparedCoordinatorRecommendation(event, { ...request, commandId: randomUUID(), expectedVersion: 1, recommendation: "Use the later dinner window." }, { databaseUrl: url, operatorPersonId: operator, organizerPersonId: organizer });
    assert.equal(revised.version, 2);
    assert.equal((await saveOperatorPreparedCoordinatorRecommendation(event, request, { databaseUrl: url, operatorPersonId: operator, organizerPersonId: organizer })).version, 1, "an old durable receipt cannot overwrite a later revision");
    assert.equal((await listCoordinatorRecommendations(event, { databaseUrl: url, actorPersonId: organizer }))[0].version, 2);
    await database.db.insert(pollResponses).values({ pollId, respondentName: "Synthetic traveler", receiptTokenHash: `receipt-${randomUUID()}`, answers: [] });
    assert.equal((await listCoordinatorRecommendations(event, { databaseUrl: url, actorPersonId: organizer }))[0].evidenceCurrent, false, "new ballot evidence makes the saved preparation stale");
    await assert.rejects(saveOperatorPreparedCoordinatorRecommendation(event, { ...request, commandId: randomUUID(), expectedVersion: 2 }, { databaseUrl: url, operatorPersonId: operator, organizerPersonId: organizer }), CommandConflictError);
    const audits = await database.db.select().from(operatorAuditEvents).where(and(eq(operatorAuditEvents.actorPersonId, operator), eq(operatorAuditEvents.resourceId, saved.id)));
    assert.equal(audits.length, 2, "each distinct prepared revision is operator-attributed once"); assert.ok(audits.every(item => item.action === "coordinator_recommendation.prepared"));
    assert.equal((await database.db.select().from(coordinatorRecommendations).where(eq(coordinatorRecommendations.id, saved.id)))[0].ownerPersonId, organizer);
  } finally {
    try {
      await database.db.delete(operatorAuditEvents).where(inArray(operatorAuditEvents.actorPersonId, [operator, secondOperator]));
      await database.db.delete(commons).where(eq(commons.id, event));
      await database.db.delete(people).where(inArray(people.id, [organizer, otherOrganizer, operator, secondOperator]));
    } finally { await database.close(); }
  }
});
