import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, identities, instanceSettings, invitations, messagingWebNudges, people } from "./schema";
import { hashNormalizedEmail } from "./tokens";
import {
  InstanceAdminRequiredError, claimInstanceAdminIfUnset, claimMessageNotices, emailHasAccount, emailHasPendingInvitation, forgetKnownInstanceAdminsForTests,
  isInstanceAdmin, markMessagesRead, readInstanceSettings, storedInvitationTokenKey, updateInstanceSignup,
} from "./instance-repository";

const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
const url = () => { const value = process.env.TEST_DATABASE_URL!; assert.equal(new URL(value).hostname, "127.0.0.1"); assert.ok(new URL(value).pathname.endsWith("_test")); return value; };

test("the first person to sign in becomes the instance admin, once, and only the admin changes who can join", { skip }, async () => {
  const db = createDatabase(url()), first = randomUUID(), second = randomUUID();
  await db.db.delete(instanceSettings); forgetKnownInstanceAdminsForTests();
  await db.db.insert(people).values([{ id: first, authUserId: first, displayName: "First synthetic" }, { id: second, authUserId: second, displayName: "Second synthetic" }]);
  try {
    assert.deepEqual(await readInstanceSettings(url()), { adminPersonId: null, signupMode: "invited", allowedDomains: [] });
    const winners = await Promise.all([claimInstanceAdminIfUnset(first, url()), (forgetKnownInstanceAdminsForTests(), claimInstanceAdminIfUnset(second, url()))]);
    assert.equal(new Set(winners).size, 1, "concurrent first sign-ins agree on one admin");
    const admin = winners[0]!, other = admin === first ? second : first;
    forgetKnownInstanceAdminsForTests();
    assert.equal(await claimInstanceAdminIfUnset(other, url()), admin, "a later sign-in never takes over");
    assert.equal(await isInstanceAdmin(admin, url()), true);
    assert.equal((await readInstanceSettings(url())).signupMode, "invited", "invited only is the default");
    await assert.rejects(updateInstanceSignup(other, { signupMode: "anyone", allowedDomains: [] }, url()), InstanceAdminRequiredError);
    const updated = await updateInstanceSignup(admin, { signupMode: "domains", allowedDomains: ["example.org"] }, url());
    assert.deepEqual([updated.signupMode, updated.allowedDomains], ["domains", ["example.org"]]);
  } finally {
    await db.db.delete(instanceSettings); forgetKnownInstanceAdminsForTests();
    await db.db.delete(people).where(inArray(people.id, [first, second])); await db.close();
  }
});

test("signup checks find existing accounts and pending invitations, and the generated invitation key is kept", { skip }, async () => {
  const db = createDatabase(url()), owner = randomUUID(), provisional = randomUUID(), trip = randomUUID(), marker = randomUUID().slice(0, 8);
  const member = `member-${marker}@example.test`, invited = `invited-${marker}@example.test`, expired = `expired-${marker}@example.test`;
  await db.db.insert(people).values([{ id: owner, authUserId: owner, displayName: "Owner synthetic" }, { id: provisional, displayName: "Invited synthetic" }]);
  await db.db.insert(identities).values({ personId: owner, kind: "email", normalizedHash: hashNormalizedEmail(member), state: "claimed" });
  await db.db.insert(commons).values({ id: trip, slug: `instance-${trip}`, name: "Instance synthetic", createdByPersonId: owner, timezone: "America/Denver" });
  await db.db.insert(invitations).values([
    { commonsId: trip, provisionalPersonId: provisional, createdByPersonId: owner, recipientName: "Invited", recipientEmail: invited.toUpperCase(), tokenHash: `t-${marker}-1`, status: "pending" },
    { commonsId: trip, provisionalPersonId: provisional, createdByPersonId: owner, recipientName: "Expired", recipientEmail: expired, tokenHash: `t-${marker}-2`, status: "pending", expiresAt: new Date(Date.now() - 60_000) },
  ] as never);
  try {
    assert.equal(await emailHasAccount(` ${member.toUpperCase()} `, url()), true);
    assert.equal(await emailHasAccount(invited, url()), false);
    assert.equal(await emailHasPendingInvitation(invited, url()), true);
    assert.equal(await emailHasPendingInvitation(expired, url()), false);
    assert.equal(await emailHasPendingInvitation(`stranger-${marker}@example.test`, url()), false);
    await db.db.delete(instanceSettings);
    const key = await storedInvitationTokenKey(url());
    assert.equal(Buffer.from(key, "base64").length, 32);
    assert.equal(await storedInvitationTokenKey(url()), key, "created once, then reused");
  } finally {
    await db.db.delete(instanceSettings); forgetKnownInstanceAdminsForTests();
    await db.db.delete(commons).where(eq(commons.id, trip)); await db.db.delete(people).where(inArray(people.id, [owner, provisional])); await db.close();
  }
});

test("a person gets one new-message notice until they open their thread", { skip }, async () => {
  const db = createDatabase(url()), maya = randomUUID(), sam = randomUUID();
  await db.db.insert(people).values([{ id: maya, authUserId: maya, displayName: "Maya synthetic" }, { id: sam, authUserId: sam, displayName: "Sam synthetic" }]);
  const at = (minutes: number) => new Date(Date.parse("2027-03-01T17:00:00Z") + minutes * 60_000);
  try {
    assert.deepEqual((await claimMessageNotices([maya, sam, maya], at(0), url())).sort(), [maya, sam].sort(), "one each, even when listed twice");
    assert.deepEqual(await claimMessageNotices([maya, sam], at(5), url()), [], "no second notice before they read");
    await markMessagesRead(maya, at(10), url());
    assert.deepEqual(await claimMessageNotices([maya, sam], at(20), url()), [], "not while they are reading");
    assert.deepEqual(await claimMessageNotices([maya, sam], at(30), url()), [maya], "reading the thread re-arms the notice");
    const [row] = await db.db.select().from(messagingWebNudges).where(eq(messagingWebNudges.personId, maya));
    assert.equal(row!.lastNudgedAt!.toISOString(), at(30).toISOString());
  } finally {
    await db.db.delete(people).where(inArray(people.id, [maya, sam])); await db.close();
  }
});
