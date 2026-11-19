import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import {
  completeConversationDigest,
  leaseConversationDigest,
  queueConversationDigests,
} from "./conversation-digest-repository";
import {
  addCommonsExpense,
  appendCommonsMessage,
  getCommonsSnapshot,
} from "./pilot-repository";
import { getTravelerProfile, updateTravelerProfile } from "./profile-repository";
import {
  commons,
  auditEvents,
  conversationDigestDeliveries,
  conversationDigestItems,
  memberships,
  people,
} from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

test("commits one durable daily digest for every participant's shared activity", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL or DATABASE_URL is required");
  const database = createDatabase(databaseUrl);
  const personIds: string[] = [];
  let commonsId: string | undefined;
  try {
    const insertedPeople = await database.db.insert(people).values([
      { displayName: "Digest Sender", authUserId: randomUUID() },
      { displayName: "Digest Recipient", authUserId: randomUUID() },
      { displayName: "Other Event Traveler", authUserId: randomUUID() },
    ]).returning({ id: people.id });
    personIds.push(...insertedPeople.map((person) => person.id));
    const [event] = await database.db.insert(commons).values({
      slug: `digest-${randomUUID().slice(0, 8)}`,
      name: "Digest Test Event",
      timezone: "America/Denver",
      createdByPersonId: personIds[0]!,
    }).returning({ id: commons.id, slug: commons.slug });
    assert.ok(event);
    commonsId = event.id;
    await database.db.insert(memberships).values([
      { commonsId, personId: personIds[0]!, status: "active", role: "organizer" },
      { commonsId, personId: personIds[1]!, status: "active", role: "member" },
    ]);

    const options = { databaseUrl, actorPersonId: personIds[0]! };
    const messageCommand = {
      commandId: randomUUID(),
      body: "Should we book the cottage?",
      occurredAt: new Date().toISOString(),
    };
    await appendCommonsMessage(event.slug, messageCommand, options);
    await appendCommonsMessage(event.slug, messageCommand, options);
    await addCommonsExpense(event.slug, {
      commandId: randomUUID(),
      title: "Cottage deposit",
      amountCents: 12_550,
      paidByPersonId: personIds[0]!,
      occurredOn: "2026-08-31",
      category: "Lodging",
      splitMethod: "equal",
      shares: [
        { personId: personIds[0]!, amountCents: 6_275 },
        { personId: personIds[1]!, amountCents: 6_275 },
      ],
    }, options);

    const refreshed = await getCommonsSnapshot(event.slug, {
      databaseUrl,
      actorPersonId: personIds[1]!,
    });
    assert.equal(refreshed?.state.messages.at(-1)?.body, "Should we book the cottage?");
    assert.equal(refreshed?.state.expenses.at(-1)?.title, "Cottage deposit");

    const pendingItems = await database.db.select().from(conversationDigestItems)
      .where(eq(conversationDigestItems.commonsId, commonsId));
    assert.equal(pendingItems.length, 4, "a retried command must not duplicate digest work");
    assert.deepEqual(
      pendingItems.reduce<Record<string, number>>((counts, item) => {
        counts[item.recipientPersonId] = (counts[item.recipientPersonId] ?? 0) + 1;
        return counts;
      }, {}),
      { [personIds[0]!]: 2, [personIds[1]!]: 2 },
      "the actor and every other active participant receive the same source activity",
    );
    assert.ok(pendingItems.every((item) => item.deliveryId === null));

    await assert.rejects(
      () => appendCommonsMessage(event.slug, {
        commandId: randomUUID(),
        body: "This person is not in the event.",
        occurredAt: new Date().toISOString(),
      }, { databaseUrl, actorPersonId: personIds[2]! }),
      (error: unknown) => error instanceof Error
        && "code" in error && error.code === "actor_not_authorized",
    );

    await database.db.insert(auditEvents).values([
      {
        commonsId,
        commandId: randomUUID(),
        actorId: personIds[0]!,
        actorType: "human",
        action: "commons.cover_updated",
        resourceType: "commons",
        resourceId: commonsId,
        summary: "Digest Sender changed the trip cover.",
      },
      {
        commonsId,
        commandId: randomUUID(),
        actorId: personIds[0]!,
        actorType: "human",
        action: "travel_plan.saved",
        resourceType: "travel_plan",
        resourceId: randomUUID(),
        summary: "Digest Sender saved private confirmation details.",
      },
    ]);

    const firstRun = new Date(Date.now() + 60_000);
    assert.equal((await queueConversationDigests(firstRun, databaseUrl)).queued, 2);
    const initialDigests = [];
    for (let index = 0; index < 2; index += 1) {
      const leased = await leaseConversationDigest(firstRun, databaseUrl);
      assert.ok(leased);
      initialDigests.push(leased);
      await completeConversationDigest(leased.id, { leaseAttempt: leased.leaseAttempt, sent: true, providerMessageId: `digest-provider-1-${index}` }, firstRun, databaseUrl);
    }
    assert.deepEqual(initialDigests.map((digest) => digest.payload.recipientName).sort(), ["Digest Recipient", "Digest Sender"]);
    for (const digest of initialDigests) {
      assert.equal(digest.payload.events[0]?.messageCount, 1);
      assert.equal(digest.payload.events[0]?.messages[0]?.body, "Should we book the cottage?");
      assert.equal(digest.payload.events[0]?.expenseCount, 1);
      assert.equal(digest.payload.events[0]?.expenses?.[0]?.title, "Cottage deposit");
      assert.equal(digest.payload.events[0]?.activityCount, 1);
      assert.deepEqual(digest.payload.events[0]?.activities?.map((activity) => activity.summary), [
        "Trip cover changed.",
      ]);
      assert.doesNotMatch(JSON.stringify(digest.payload), /private confirmation details/);
    }
    assert.deepEqual(
      initialDigests[0]?.payload.events,
      initialDigests[1]?.payload.events,
      "every eligible participant receives the same shared trip update",
    );
    assert.equal(await leaseConversationDigest(firstRun, databaseUrl), null);
    assert.equal((await queueConversationDigests(firstRun, databaseUrl)).queued, 0);

    assert.equal((await getTravelerProfile(personIds[1]!, databaseUrl))?.dailyDigestEnabled, true);
    await updateTravelerProfile(personIds[1]!, { usualOriginLabel: "Denver" }, databaseUrl);
    await appendCommonsMessage(event.slug, {
      commandId: randomUUID(),
      body: "I added the cancellation policy.",
      occurredAt: new Date().toISOString(),
    }, options);
    assert.equal((await queueConversationDigests(firstRun, databaseUrl)).queued, 0, "one recipient receives at most one digest per period");
    const nextRun = new Date(firstRun.getTime() + 24 * 60 * 60 * 1000);
    assert.equal((await queueConversationDigests(nextRun, databaseUrl)).queued, 2, "new work remains queued for every participant in the next period");
    await updateTravelerProfile(personIds[1]!, { dailyDigestEnabled: false }, databaseUrl);
    const mutedProfile = await getTravelerProfile(personIds[1]!, databaseUrl);
    assert.equal(mutedProfile?.dailyDigestEnabled, false);
    assert.equal(mutedProfile?.usualOriginLabel, "Denver", "notification changes must not overwrite travel defaults");
    const senderDigest = await leaseConversationDigest(nextRun, databaseUrl);
    assert.ok(senderDigest);
    assert.equal(senderDigest.payload.recipientName, "Digest Sender");
    await completeConversationDigest(senderDigest.id, { leaseAttempt: senderDigest.leaseAttempt, sent: true, providerMessageId: "digest-provider-sender" }, nextRun, databaseUrl);
    assert.equal(await leaseConversationDigest(nextRun, databaseUrl), null, "turning email off cancels only that participant's unsent work");
    const [cancelled] = await database.db.select({
      id: conversationDigestDeliveries.id,
      status: conversationDigestDeliveries.status,
    })
      .from(conversationDigestDeliveries)
      .where(and(
        eq(conversationDigestDeliveries.recipientPersonId, personIds[1]!),
        eq(conversationDigestDeliveries.status, "cancelled"),
      ))
      .limit(1);
    assert.equal(cancelled?.status, "cancelled");
    assert.ok(cancelled);
    await completeConversationDigest(cancelled.id, { leaseAttempt: 0, sent: false, errorCode: "provider_unavailable" }, nextRun, databaseUrl);
    const [stillCancelled] = await database.db.select({ status: conversationDigestDeliveries.status })
      .from(conversationDigestDeliveries)
      .where(eq(conversationDigestDeliveries.id, cancelled.id))
      .limit(1);
    assert.equal(stillCancelled?.status, "cancelled", "a late provider failure must not reopen opted-out work");

    await appendCommonsMessage(event.slug, {
      commandId: randomUUID(),
      body: "This should stay muted.",
      occurredAt: new Date().toISOString(),
    }, options);
    await updateTravelerProfile(personIds[1]!, { dailyDigestEnabled: true }, databaseUrl);
    await appendCommonsMessage(event.slug, {
      commandId: randomUUID(),
      body: "Daily email is back on.",
      occurredAt: new Date().toISOString(),
    }, options);
    const resumedRun = new Date(nextRun.getTime() + 24 * 60 * 60 * 1000);
    assert.equal((await queueConversationDigests(resumedRun, databaseUrl)).queued, 2);
    const resumedDigests = [];
    for (let index = 0; index < 2; index += 1) {
      const resumedDigest = await leaseConversationDigest(resumedRun, databaseUrl);
      assert.ok(resumedDigest);
      resumedDigests.push(resumedDigest);
      await completeConversationDigest(resumedDigest.id, { leaseAttempt: resumedDigest.leaseAttempt, sent: true, providerMessageId: `digest-provider-2-${index}` }, resumedRun, databaseUrl);
    }
    const recipientDigest = resumedDigests.find((digest) => digest.payload.recipientName === "Digest Recipient");
    assert.deepEqual(recipientDigest?.payload.events[0]?.messages.map((message) => message.body), ["Daily email is back on."]);
  } finally {
    if (commonsId) await database.db.delete(commons).where(eq(commons.id, commonsId));
    if (personIds.length) await database.db.delete(people).where(inArray(people.id, personIds));
    await database.close();
  }
});
