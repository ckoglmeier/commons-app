import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { createFeedbackSubmission } from "./feedback-repository";
import { requestEventCreationAccess } from "./operator-repository";
import { leaseOperatorNotification, completeOperatorNotification } from "./operator-notification-repository";
import { feedbackSubmissions, people, operatorNotificationDeliveries as deliveries, eventCreationAccess } from "./schema";

test("feedback and access requests queue once, survive delivery failure, fence leases, and deny browser access", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname) && new URL(url).pathname.endsWith("_test"));
  const database = createDatabase(url);
  const feedbackIds: string[] = [];
  const keys: string[] = [];
  let personId: string | undefined;
  try {
    const input = { commonsSlug: "synthetic-qa", questionVersion: 2 as const, source: "feedback_button" as const,
      answers: { category: "problem" as const, message: "Synthetic notification test" }, pagePath: "/c/synthetic-qa?view=plan", idempotencyKey: randomUUID() };
    const results = await Promise.all([createFeedbackSubmission(input, url), createFeedbackSubmission(input, url)]);
    assert.equal(results[0].id, results[1].id);
    feedbackIds.push(results[0].id);
    const key = `feedback:${results[0].id}`;
    keys.push(key);
    const saved = await database.db.select().from(deliveries).where(eq(deliveries.dedupeKey, key));
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].payload, { kind: "feedback", feedbackId: results[0].id, submission: input });
    const leases = await Promise.all([leaseOperatorNotification(url, key), leaseOperatorNotification(url, key)]);
    const job = leases.find(Boolean);
    assert.ok(job && !job.skipped);
    assert.equal(leases.filter(Boolean).length, 1);
    assert.equal(await completeOperatorNotification(job.id, job.attempt, { sent: false, errorCode: "provider_unavailable" }, url), true);
    assert.equal(await leaseOperatorNotification(url, key), null, "Backoff prevents immediate retries");
    await database.db.update(deliveries).set({ availableAt: new Date(0) }).where(eq(deliveries.id, job.id));
    const retry = await leaseOperatorNotification(url, key);
    assert.ok(retry && !retry.skipped);
    assert.equal(retry.id, job.id);
    assert.equal(retry.attempt, 2);
    assert.equal(await completeOperatorNotification(job.id, job.attempt, { sent: true }, url), false, "Old lease cannot acknowledge new attempt");
    assert.equal(await completeOperatorNotification(retry.id, retry.attempt, { sent: true, providerMessageId: "qa-provider" }, url), true);
    assert.equal(await leaseOperatorNotification(url, key), null);
    assert.equal((await database.db.select().from(feedbackSubmissions).where(eq(feedbackSubmissions.id, results[0].id))).length, 1);

    const [person] = await database.db.insert(people).values({ displayName: "Synthetic access requester", authUserId: randomUUID() }).returning();
    personId = person.id;
    const requests = await Promise.all([requestEventCreationAccess({ personId, email: "QA@example.com" }, url), requestEventCreationAccess({ personId, email: "qa@example.com" }, url)]);
    assert.equal(requests[0].requestedAt.toISOString(), requests[1].requestedAt.toISOString());
    const accessKey = `beta-access:${personId}:${requests[0].requestedAt.toISOString()}`;
    keys.push(accessKey);
    const accessJobs = await database.db.select().from(deliveries).where(eq(deliveries.dedupeKey, accessKey));
    assert.equal(accessJobs.length, 1);
    assert.deepEqual(accessJobs[0].payload, { kind: "beta_access", email: "qa@example.com", personId });
    await database.db.update(eventCreationAccess).set({ status: "approved" }).where(eq(eventCreationAccess.personId, personId));
    assert.equal((await requestEventCreationAccess({ personId, email: "qa@example.com" }, url)).status, "approved");
    assert.equal((await database.db.select().from(deliveries).where(eq(deliveries.dedupeKey, accessKey))).length, 1);

    for (const role of ["anon", "authenticated"]) await assert.rejects(database.db.transaction(async tx => {
      await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`));
      await tx.select().from(deliveries);
    }), /permission denied|Failed query/);
  } finally {
    if (keys.length) await database.db.delete(deliveries).where(inArray(deliveries.dedupeKey, keys));
    if (feedbackIds.length) await database.db.delete(feedbackSubmissions).where(inArray(feedbackSubmissions.id, feedbackIds));
    if (personId) await database.db.delete(people).where(eq(people.id, personId));
    await database.close();
  }
});
