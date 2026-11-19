import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "./client";
import {
  decideEventCreationAccess,
  getEventCreationAccess,
  listOperatorOverview,
  requestEventCreationAccess,
  retryOperatorConversationDigest,
  searchOperatorAccounts,
} from "./operator-repository";
import { conversationDigestDeliveries, identities, operatorAuditEvents, people } from "./schema";
import { hashNormalizedEmail } from "./tokens";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

test("creation access can be requested, approved, revoked, and audited", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL or DATABASE_URL is required");
  const database = createDatabase(databaseUrl);
  let actorPersonId: string | null = null;
  let requesterPersonId: string | null = null;

  try {
    const [actor] = await database.db.insert(people).values({ displayName: "Pilot Operator" }).returning({ id: people.id });
    const [requester] = await database.db.insert(people).values({
      displayName: "Pilot Requester",
      authUserId: randomUUID(),
    }).returning({ id: people.id });
    actorPersonId = actor.id;
    requesterPersonId = requester.id;

    const requested = await requestEventCreationAccess({ personId: requester.id, email: "PILOT@example.com" }, databaseUrl);
    assert.equal(requested.status, "requested");
    assert.equal(requested.requesterEmail, "pilot@example.com");

    const duplicate = await requestEventCreationAccess({ personId: requester.id, email: "pilot@example.com" }, databaseUrl);
    assert.equal(duplicate.personId, requested.personId);
    assert.equal((await listOperatorOverview(databaseUrl)).access.filter((row) => row.personId === requester.id).length, 1);

    const now = new Date();
    const [digest] = await database.db.insert(conversationDigestDeliveries).values({
      recipientPersonId: requester.id,
      periodKey: `operator-${Date.now()}`,
      windowStartedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      windowEndedAt: now,
      payload: {
        recipientAuthUserId: "operator-test-auth",
        recipientName: "Pilot Requester",
        events: [{
          name: "Private test event",
          slug: "private-test-event",
          messageCount: 1,
          messages: [{ actorName: "Someone", body: "Private content", occurredAt: now.toISOString() }],
        }],
      },
      status: "failed",
      attempts: 5,
      errorCode: "provider_unavailable",
      availableAt: now,
    }).returning({ id: conversationDigestDeliveries.id });

    const digestOverview = (await listOperatorOverview(databaseUrl)).digests
      .find((row) => row.id === digest.id);
    assert.ok(digestOverview);
    assert.equal(digestOverview.recipientName, "Pilot Requester");
    assert.equal(digestOverview.eventCount, 1);
    assert.equal("payload" in digestOverview, false, "operator summaries must not expose digest content");

    await retryOperatorConversationDigest({
      deliveryId: digest.id,
      actorPersonId: actor.id,
      reason: "Integration test retry",
    }, databaseUrl);
    const [retried] = await database.db.select().from(conversationDigestDeliveries)
      .where(eq(conversationDigestDeliveries.id, digest.id)).limit(1);
    assert.ok(retried);
    assert.equal(retried.status, "queued");
    assert.equal(retried.attempts, 0);
    assert.equal(retried.errorCode, null);

    await decideEventCreationAccess({ personId: requester.id, status: "approved", actorPersonId: actor.id, reason: "Integration test approval" }, databaseUrl);
    assert.equal((await getEventCreationAccess(requester.id, databaseUrl))?.status, "approved");

    await decideEventCreationAccess({ personId: requester.id, status: "revoked", actorPersonId: actor.id, reason: "Integration test revocation" }, databaseUrl);
    const revoked = await getEventCreationAccess(requester.id, databaseUrl);
    assert.equal(revoked?.status, "revoked");
    assert.equal(revoked?.decidedByPersonId, actor.id);

    const audit = await database.db.select().from(operatorAuditEvents)
      .where(eq(operatorAuditEvents.actorPersonId, actor.id));
    assert.deepEqual(audit.map((row) => row.action).sort(), [
      "conversation_digest.retry_queued",
      "event_creation_access.approved",
      "event_creation_access.revoked",
    ]);
    const accessAudit = audit.filter((row) => row.resourceType === "person");
    assert.ok(accessAudit.every((row) => row.resourceId === requester.id));
    assert.equal(
      audit.find((row) => row.action === "conversation_digest.retry_queued")?.resourceId,
      digest.id,
    );
  } finally {
    if (actorPersonId) await database.db.delete(operatorAuditEvents).where(eq(operatorAuditEvents.actorPersonId, actorPersonId));
    if (requesterPersonId) await database.db.delete(people).where(eq(people.id, requesterPersonId));
    if (actorPersonId) await database.db.delete(people).where(eq(people.id, actorPersonId));
    await database.close();
  }
});

test("operators can find a claimed account and grant access without a prior request", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL or DATABASE_URL is required");
  const database = createDatabase(databaseUrl);
  let actorPersonId: string | null = null;
  let accountPersonId: string | null = null;

  try {
    const [actor] = await database.db.insert(people).values({
      displayName: "Access Operator",
      authUserId: randomUUID(),
    }).returning({ id: people.id });
    const [account] = await database.db.insert(people).values({
      displayName: "Direct Access Traveler",
      authUserId: randomUUID(),
    }).returning({ id: people.id });
    actorPersonId = actor.id;
    accountPersonId = account.id;
    const email = `direct-access-${Date.now()}@example.com`;
    await database.db.insert(identities).values({
      personId: account.id,
      kind: "email",
      normalizedHash: hashNormalizedEmail(email),
      state: "claimed",
      verifiedAt: new Date(),
    });

    const byName = await searchOperatorAccounts("Direct Access", databaseUrl);
    assert.equal(byName.find((row) => row.personId === account.id)?.accessStatus, null);
    const byEmail = await searchOperatorAccounts(email.toUpperCase(), databaseUrl);
    assert.equal(byEmail.length, 1);
    assert.equal(byEmail[0]?.personId, account.id);

    await assert.rejects(
      decideEventCreationAccess({
        personId: account.id,
        status: "approved",
        actorPersonId: actor.id,
        requesterEmail: "different-account@example.com",
      }, databaseUrl),
      /does not belong to the selected account/,
    );

    await decideEventCreationAccess({
      personId: account.id,
      status: "approved",
      actorPersonId: actor.id,
      requesterEmail: email,
      reason: "Direct pilot grant",
    }, databaseUrl);
    const approved = await getEventCreationAccess(account.id, databaseUrl);
    assert.equal(approved?.status, "approved");
    assert.equal(approved?.requesterEmail, email);

    await decideEventCreationAccess({
      personId: account.id,
      status: "revoked",
      actorPersonId: actor.id,
      reason: "Direct pilot revocation",
    }, databaseUrl);
    const audit = await database.db.select().from(operatorAuditEvents)
      .where(eq(operatorAuditEvents.actorPersonId, actor.id));
    assert.deepEqual(audit.map((row) => row.action).sort(), [
      "event_creation_access.approved",
      "event_creation_access.revoked",
    ]);
  } finally {
    if (actorPersonId) await database.db.delete(operatorAuditEvents).where(eq(operatorAuditEvents.actorPersonId, actorPersonId));
    if (accountPersonId) await database.db.delete(people).where(eq(people.id, accountPersonId));
    if (actorPersonId) await database.db.delete(people).where(eq(people.id, actorPersonId));
    await database.close();
  }
});
