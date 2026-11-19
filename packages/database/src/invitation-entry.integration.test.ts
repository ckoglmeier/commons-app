import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, invitations, invitationDeliveryAttempts, memberships, people } from "./schema";
import { hashOpaqueToken, protectOpaqueToken } from "./tokens";
import { cacheInvitationAuthenticationEntry, getInvitationEntryContext, queueInvitationEntryRecovery } from "./invitation-entry";
import { claimCommonsInvitation, completeInvitationDeliveryAttempt, leaseInvitationDeliveryAttempt, revalidateInvitationDeliveryAttempt } from "./onboarding-repository";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";
async function fixture() {
  const url = process.env.TEST_DATABASE_URL; assert.ok(url);
  const db = createDatabase(url), org = randomUUID(), guest = randomUUID(), event = randomUUID(), invite = randomUUID(), auth = randomUUID(), token = randomUUID() + randomUUID();
  await db.db.insert(people).values([{ id: org, displayName: "Organizer", authUserId: randomUUID() }, { id: guest, displayName: "Guest" }]);
  await db.db.insert(commons).values({ id: event, slug: `entry-${event}`, name: "Synthetic invitation test", timezone: "UTC", createdByPersonId: org });
  await db.db.insert(memberships).values([{ commonsId: event, personId: org, role: "organizer", status: "active" }, { commonsId: event, personId: guest, role: "member", status: "invited" }]);
  await db.db.insert(invitations).values({ id: invite, commonsId: event, provisionalPersonId: guest, createdByPersonId: org,
    recipientEmail: "guest@example.test", recipientName: "Guest", tokenHash: hashOpaqueToken(token), tokenValue: protectOpaqueToken(token), expiresAt: new Date(0) });
  return { db, url, token, event, invite, guest, auth, async close() {
    await db.db.delete(commons).where(eq(commons.id, event)); await db.db.delete(people).where(inArray(people.id, [org, guest])); await db.close();
  } };
}
test("durable invitation recovery survives old expiry, retains poll context and limits concurrent sends", { skip: !run }, async () => {
  const f = await fixture(); try {
    assert.equal((await getInvitationEntryContext(f.token, f.url))?.status, "pending");
    const results = await Promise.all(Array.from({ length: 8 }, () => queueInvitationEntryRecovery(f.token, "abcdef123456", f.url)));
    assert.equal(results.filter(r => r.status === "queued").length, 1);
    assert.equal(results.filter(r => r.status === "limited").length, 7);
    const queued = results.find(r => r.status === "queued"); assert.ok(queued && queued.status === "queued");
    const lease = await leaseInvitationDeliveryAttempt(queued.deliveryAttemptId, f.url); assert.ok(lease);
    assert.equal(lease.returnPollPublicId, "abcdef123456");
    assert.equal(await revalidateInvitationDeliveryAttempt(lease.deliveryAttemptId, lease.leaseAttempt, f.url), true);
    assert.equal((await getInvitationEntryContext(f.token, f.url))?.tokenVersion, lease.tokenVersion);
    await assert.rejects(queueInvitationEntryRecovery(f.token, "//evil", f.url));
  } finally { await f.close(); }
});
test("delivery caches the exact email proof across retries, fences stale workers, and stops on revocation", { skip: !run }, async () => {
  const f = await fixture(); try {
    const queued = await queueInvitationEntryRecovery(f.token, null, f.url); assert.equal(queued.status, "queued");
    const lease = await leaseInvitationDeliveryAttempt(queued.deliveryAttemptId!, f.url); assert.ok(lease);
    await cacheInvitationAuthenticationEntry(lease.deliveryAttemptId, lease.leaseAttempt, "encrypted-synthetic-proof", f.url);
    await completeInvitationDeliveryAttempt(lease.deliveryAttemptId, { sent: false, leaseAttempt: lease.leaseAttempt, errorCode: "provider_unavailable" }, f.url);
    const retry = await leaseInvitationDeliveryAttempt(lease.deliveryAttemptId, f.url); assert.ok(retry);
    assert.equal(retry.authenticationEntry, "encrypted-synthetic-proof");
    await assert.rejects(cacheInvitationAuthenticationEntry(lease.deliveryAttemptId, lease.leaseAttempt, "replacement", f.url));
    await f.db.db.update(invitations).set({ status: "revoked" }).where(eq(invitations.id, f.invite));
    assert.equal(await getInvitationEntryContext(f.token, f.url), null);
    assert.equal(await revalidateInvitationDeliveryAttempt(retry.deliveryAttemptId, retry.leaseAttempt, f.url), false);
    await assert.rejects(queueInvitationEntryRecovery(f.token, null, f.url));
    assert.equal((await f.db.db.select().from(invitationDeliveryAttempts).where(eq(invitationDeliveryAttempts.id, retry.deliveryAttemptId)))[0].authenticationEntry, "encrypted-synthetic-proof");
  } finally { await f.close(); }
});
test("accepted invitations reopen only for the active claimant; removal cannot restore membership", { skip: !run }, async () => {
  const f = await fixture(); try {
    const identity = { authUserId: f.auth, email: "guest@example.test", displayName: "Guest" };
    await claimCommonsInvitation(f.token, identity, f.url);
    assert.equal((await getInvitationEntryContext(f.token, f.url))?.acceptedAuthUserId, f.auth);
    assert.equal(await claimCommonsInvitation(f.token, identity, f.url), `entry-${f.event}`);
    await assert.rejects(claimCommonsInvitation(f.token, { ...identity, authUserId: randomUUID() }, f.url));
    await f.db.db.update(memberships).set({ attendanceState: "declined" }).where(eq(memberships.personId, f.guest));
    assert.equal(await getInvitationEntryContext(f.token, f.url), null);
    await assert.rejects(claimCommonsInvitation(f.token, identity, f.url));
  } finally { await f.close(); }
});
