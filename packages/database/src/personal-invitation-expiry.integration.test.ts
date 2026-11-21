import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, invitations, memberships, people } from "./schema";
import { getInvitationEntryContext, queueInvitationEntryRecovery } from "./invitation-entry";
import {
  addCommonsPerson,
  claimCommonsInvitation,
  getCommonsInvitationLink,
  getCommonsInvitationPreview,
  getCommonsPeople,
  listPendingCommonsInvitationsForIdentity,
  PERSONAL_INVITATION_LIFETIME_MS,
  personalInvitationExpired,
  personalInvitationExpiry,
  queueCommonsInvitationDeliveries,
  rotateCommonsInvitationLink,
  saveCommonsSetupTravelers,
  updateCommonsPendingInvitation,
} from "./onboarding-repository";

const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
const DAY = 24 * 60 * 60 * 1000;

test("a personal invitation link works for 30 days; the boundary instant is already expired", () => {
  assert.equal(PERSONAL_INVITATION_LIFETIME_MS, 30 * DAY);
  const now = new Date("2026-11-20T12:00:00.000Z");
  assert.equal(personalInvitationExpiry(now).toISOString(), "2026-12-20T12:00:00.000Z");
  assert.equal(personalInvitationExpired(null, now), false, "no expiry yet (made before links expired) is still valid");
  assert.equal(personalInvitationExpired(new Date(now.getTime() + 1), now), false);
  assert.equal(personalInvitationExpired(new Date(now.getTime()), now), true);
  assert.equal(personalInvitationExpired(new Date(now.getTime() - 1), now), true);
});

function assertAbout30Days(value: Date | string | null | undefined, label: string) {
  assert.ok(value, `${label} has an expiry`);
  const remaining = new Date(value).getTime() - Date.now();
  assert.ok(remaining > 30 * DAY - 60_000 && remaining <= 30 * DAY + 1_000, `${label} expires about 30 days from now`);
}

test("personal invitation links: made, copied, replaced and re-sent with a 30-day expiry; expired links stop working", { skip }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
  const db = createDatabase(url), owner = randomUUID(), trip = randomUUID();
  const options = { databaseUrl: url, actorPersonId: owner };
  const accounts: string[] = [];
  const setExpiry = (id: string, expiresAt: Date | null) => db.db.update(invitations).set({ expiresAt }).where(eq(invitations.id, id));
  const stored = async (id: string) => (await db.db.select().from(invitations).where(eq(invitations.id, id)))[0]!;
  const invite = async (name: string) => {
    const email = `${name.toLowerCase().replace(/\s+/g, "-")}-${randomUUID()}@example.com`;
    const { invitationId } = await addCommonsPerson(trip, { displayName: name, email }, options);
    return { email, id: invitationId! };
  };
  const account = (email?: string) => { const authUserId = randomUUID(); accounts.push(authUserId); return { authUserId, email, displayName: "Synthetic" }; };
  try {
    await db.db.insert(people).values({ id: owner, displayName: "Organizer", authUserId: randomUUID() });
    await db.db.insert(commons).values({ id: trip, slug: trip, name: "Invitation expiry test", createdByPersonId: owner, timezone: "America/Denver" });
    await db.db.insert(memberships).values({ commonsId: trip, personId: owner, role: "organizer", status: "active" });

    // Creation and copying.
    const casey = await invite("Casey");
    assertAbout30Days((await stored(casey.id)).expiresAt, "a new invitation");
    const copied = await getCommonsInvitationLink(trip, casey.id, options);
    assert.equal(copied.expiresAt, (await stored(casey.id)).expiresAt!.toISOString(), "copying reports the link's own expiry");
    const preview = await getCommonsInvitationPreview(copied.token, url);
    assert.equal(preview?.status, "pending"); assert.equal(preview?.expiresAt, copied.expiresAt);
    await saveCommonsSetupTravelers(trip, { travelers: [{ displayName: "Riley", email: `riley-${randomUUID()}@example.com` }] }, options);
    const [riley] = await db.db.select().from(invitations).where(eq(invitations.recipientName, "Riley"));
    assertAbout30Days(riley?.expiresAt, "a traveler added in setup");

    // Just before the boundary the link still works; editing without a new link keeps its expiry.
    const sam = await invite("Sam");
    const soon = new Date(Date.now() + 60_000);
    await setExpiry(sam.id, soon);
    await updateCommonsPendingInvitation(trip, sam.id, { displayName: "Sam Lee", email: sam.email, message: null }, options);
    assert.equal((await stored(sam.id)).expiresAt?.toISOString(), soon.toISOString());
    const samLink = await getCommonsInvitationLink(trip, sam.id, options);
    assert.equal((await getCommonsInvitationPreview(samLink.token, url))?.status, "pending");
    assert.equal(await claimCommonsInvitation(samLink.token, account(sam.email), url), trip);

    // At or past the boundary: the same page as a cancelled invitation, and nothing works with the link.
    const maya = await invite("Maya");
    const mayaLink = await getCommonsInvitationLink(trip, maya.id, options);
    await setExpiry(maya.id, new Date(Date.now() - 1));
    assert.equal((await getCommonsInvitationPreview(mayaLink.token, url))?.status, "expired");
    assert.equal(await getInvitationEntryContext(mayaLink.token, url), null);
    await assert.rejects(queueInvitationEntryRecovery(mayaLink.token, null, url), /unavailable/);
    await assert.rejects(claimCommonsInvitation(mayaLink.token, account(maya.email), url), { code: "invitation_unavailable" });
    await assert.rejects(getCommonsInvitationLink(trip, maya.id, options), /expired/);
    await assert.rejects(queueCommonsInvitationDeliveries(trip, maya.id, options), /expired/);
    assert.deepEqual((await listPendingCommonsInvitationsForIdentity(account(maya.email), url)).map(row => row.token), []);
    const mayaRow = (await getCommonsPeople(trip, options))?.people.find(person => person.invitation?.id === maya.id);
    assert.equal(mayaRow?.invitation?.status, "expired");
    assert.equal((await stored(maya.id)).status, "pending", "expiry is read from the date; nothing is rewritten");

    // Replace link: a new link with a fresh 30 days, and the old one stays dead.
    const replaced = await rotateCommonsInvitationLink(trip, maya.id, options);
    assertAbout30Days(replaced.expiresAt, "a replaced link");
    assert.equal(replaced.expiresAt, (await stored(maya.id)).expiresAt!.toISOString());
    assert.equal(await getCommonsInvitationPreview(mayaLink.token, url), null);
    assert.equal(await claimCommonsInvitation(replaced.token, account(maya.email), url), trip);

    // Changing the address replaces the link, so it gets a fresh 30 days too.
    const sky = await invite("Sky");
    await setExpiry(sky.id, new Date(Date.now() + DAY));
    await updateCommonsPendingInvitation(trip, sky.id, { displayName: "Sky", email: `sky-new-${randomUUID()}@example.com`, message: null }, options);
    assertAbout30Days((await stored(sky.id)).expiresAt, "a link replaced by an address change");

    // Invitations from before links expired stay valid, then get their 30 days when copied or re-sent.
    const legacyCopy = await invite("Legacy copy");
    await setExpiry(legacyCopy.id, null);
    const legacyToken = (await stored(legacyCopy.id)).tokenValue;
    assert.ok(legacyToken);
    const legacyLink = await getCommonsInvitationLink(trip, legacyCopy.id, options);
    assertAbout30Days(legacyLink.expiresAt, "a legacy link when copied");
    assertAbout30Days((await stored(legacyCopy.id)).expiresAt, "the stored legacy expiry");
    const legacySend = await invite("Legacy send");
    await setExpiry(legacySend.id, null);
    const unsentLegacy = await getCommonsInvitationPreview((await getCommonsInvitationLink(trip, legacySend.id, options)).token, url);
    assert.equal(unsentLegacy?.status, "pending");
    await setExpiry(legacySend.id, null);
    await queueCommonsInvitationDeliveries(trip, legacySend.id, options);
    assertAbout30Days((await stored(legacySend.id)).expiresAt, "a legacy link when re-sent");
  } finally {
    try {
      const invited = (await db.db.select({ id: memberships.personId }).from(memberships).where(eq(memberships.commonsId, trip))).map(row => row.id);
      await db.db.delete(commons).where(eq(commons.id, trip));
      await db.db.delete(people).where(inArray(people.id, [owner, ...invited]));
      await db.db.delete(people).where(inArray(people.authUserId, accounts));
    } finally { await db.close(); }
  }
});
