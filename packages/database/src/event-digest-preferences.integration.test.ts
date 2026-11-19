import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { EventDigestAccessError, listEventDigestPreferences, updateEventDigestPreference } from "./event-digest-preferences";
import { queueConversationDigests, revalidateConversationDigest } from "./conversation-digest-repository";
import { appendCommonsMessage } from "./pilot-repository";
import { updateTravelerProfile } from "./profile-repository";
import { auditEvents, commons, conversationDigestDeliveries, conversationDigestItems, eventDigestPreferences, memberships, people } from "./schema";

test("event digests isolate preferences, trim queued/leased content, and do not replay muted updates", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, "Use an explicit disposable TEST_DATABASE_URL");
  const db = createDatabase(url);
  const personIds: string[] = [], eventIds: string[] = [];
  try {
    const persons = await db.db.insert(people).values([0, 1, 2].map(i => ({ displayName: `Digest QA ${i}`, authUserId: randomUUID() }))).returning();
    personIds.push(...persons.map(p => p.id));
    const events = await db.db.insert(commons).values(["A", "B"].map(name => ({ slug: `preference-${name}-${randomUUID()}`, name, timezone: "America/Denver", createdByPersonId: persons[0].id }))).returning();
    eventIds.push(...events.map(e => e.id));
    await db.db.insert(memberships).values(events.flatMap(e => persons.slice(0, 2).map((p, i) => ({ commonsId: e.id, personId: p.id, status: "active" as const, role: i === 0 ? "organizer" as const : "member" as const }))));
    const recipient = persons[1].id;
    assert.equal((await listEventDigestPreferences(recipient, url)).length, 2);
    assert.ok((await listEventDigestPreferences(recipient, url)).every(e => e.enabled));
    await assert.rejects(updateEventDigestPreference(persons[2].id, { eventId: events[0].id, enabled: false }, url), EventDigestAccessError);
    await assert.rejects(updateEventDigestPreference(recipient, { eventId: events[0].id, enabled: false, personId: persons[0].id }, url));
    const send = async (event: typeof events[number], body: string) => appendCommonsMessage(event.id,
      { commandId: randomUUID(), body, occurredAt: new Date().toISOString() }, { databaseUrl: url, actorPersonId: persons[0].id });
    await send(events[0], "A before mute"); await send(events[1], "B stays included");
    await queueConversationDigests(new Date(), url);
    const [delivery] = await db.db.select().from(conversationDigestDeliveries).where(eq(conversationDigestDeliveries.recipientPersonId, recipient));
    assert.equal(delivery.payload.events.length, 2);
    await db.db.update(conversationDigestDeliveries).set({ status: "leased", attempts: 1, leaseExpiresAt: new Date(Date.now() + 60000) }).where(eq(conversationDigestDeliveries.id, delivery.id));
    await updateEventDigestPreference(recipient, { eventId: events[0].id, enabled: false }, url);
    assert.deepEqual((await revalidateConversationDigest(delivery.id, 1, url))?.events.map(e => e.name), ["B"]);
    assert.ok((await listEventDigestPreferences(persons[0].id, url)).every(e => e.enabled), "another person's preferences stay untouched");
    await send(events[0], "Muted message");
    await db.db.insert(auditEvents).values({ commonsId: events[0].id, actorType: "human", actorId: persons[0].id, commandId: randomUUID(),
      action: "commons.title_updated", resourceType: "commons", resourceId: events[0].id, summary: "Muted change", occurredAt: new Date() });
    await updateEventDigestPreference(recipient, { eventId: events[0].id, enabled: true }, url);
    assert.deepEqual((await revalidateConversationDigest(delivery.id, 1, url))?.events.map(e => e.name), ["B"], "unmute cannot resurrect a queued section");
    const [preference] = await db.db.select().from(eventDigestPreferences).where(and(eq(eventDigestPreferences.personId, recipient), eq(eventDigestPreferences.commonsId, events[0].id)));
    await updateEventDigestPreference(recipient, { eventId: events[0].id, enabled: true }, url);
    const [retried] = await db.db.select().from(eventDigestPreferences).where(eq(eventDigestPreferences.id, preference.id));
    assert.equal(retried.resumeAfter?.toISOString(), preference.resumeAfter?.toISOString(), "same-setting retries preserve the watermark");
    await send(events[0], "New after unmute");
    for (let i = 0; i < 7; i++) await send(events[0], `New message ${i}`);
    await queueConversationDigests(new Date(Date.now() + 86400000), url);
    const items = await db.db.select().from(conversationDigestItems).where(and(eq(conversationDigestItems.recipientPersonId, recipient), eq(conversationDigestItems.commonsId, events[0].id)));
    assert.ok(!JSON.stringify(items).includes("Muted message"));
    assert.ok(!JSON.stringify(items).includes("Muted change"));
    assert.ok(JSON.stringify(items).includes("New after unmute"));
    const queued = await db.db.select().from(conversationDigestDeliveries).where(and(
      eq(conversationDigestDeliveries.recipientPersonId, recipient), eq(conversationDigestDeliveries.status, "queued")));
    assert.equal(queued.length, 1);
    await db.db.update(conversationDigestDeliveries).set({ status: "leased", attempts: 1, leaseExpiresAt: new Date(Date.now() + 60000) })
      .where(eq(conversationDigestDeliveries.id, queued[0].id));
    const resumedEvent = (await revalidateConversationDigest(queued[0].id, 1, url))?.events.find(e => e.slug === events[0].slug);
    assert.equal(resumedEvent?.messageCount, 8, "unmuting preserves full counts beyond the preview cap");
    assert.equal(resumedEvent?.messages.length, 5);
    await updateEventDigestPreference(recipient, { eventId: events[1].id, enabled: false }, url);
    assert.equal(await revalidateConversationDigest(delivery.id, 1, url), null, "empty leased email is cancelled");
    await updateTravelerProfile(recipient, { dailyDigestEnabled: false }, url);
    assert.equal((await listEventDigestPreferences(recipient, url)).find(e => e.eventId === events[0].id)?.enabled, true, "master switch retains event choices");
    const pending = await db.db.select().from(conversationDigestDeliveries).where(and(eq(conversationDigestDeliveries.recipientPersonId, recipient), inArray(conversationDigestDeliveries.status, ["queued", "leased", "failed"])));
    assert.equal(pending.length, 0);
    await db.db.update(memberships).set({ status: "removed" }).where(and(eq(memberships.personId, recipient), eq(memberships.commonsId, events[0].id)));
    await assert.rejects(updateEventDigestPreference(recipient, { eventId: events[0].id, enabled: false }, url), EventDigestAccessError);
    assert.equal((await listEventDigestPreferences(recipient, url)).length, 1);
    await db.db.transaction(async tx => {
      await tx.execute(sql`set local role authenticated`);
      await assert.rejects(tx.select().from(eventDigestPreferences));
    }).catch(error => { if (!String(error).includes("permission denied")) throw error; });
  } finally {
    if (eventIds.length) await db.db.delete(commons).where(inArray(commons.id, eventIds));
    if (personIds.length) await db.db.delete(people).where(inArray(people.id, personIds));
    await db.close();
  }
});
