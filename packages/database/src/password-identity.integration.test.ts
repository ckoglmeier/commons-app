import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, invitations, memberships, people } from "./schema";
import {
  addCommonsPerson,
  claimCommonsInvitation,
  findOrClaimPersonForAuthIdentity,
  findOrClaimPersonForInvitationLink,
  findPersonIdForAuthUser,
  getCommonsInvitationLink,
  getCommonsPeople,
  inviteManagedTraveler,
  listPendingCommonsInvitationsForIdentity,
} from "./onboarding-repository";

// Password sign-in (no email set up): the address on an account is only what the person typed. Nothing is matched by it; only an
// invitation's private link lets someone accept that invitation or become that invited person. Emailed sign-in links are unchanged.
const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";

async function fixture() {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
  const db = createDatabase(url), owner = randomUUID(), trip = randomUUID();
  await db.db.insert(people).values({ id: owner, displayName: "Organizer", authUserId: randomUUID() });
  await db.db.insert(commons).values({ id: trip, slug: trip, name: "Password identity test", createdByPersonId: owner, timezone: "America/Denver" });
  await db.db.insert(memberships).values({ commonsId: trip, personId: owner, role: "organizer", status: "active" });
  const options = { databaseUrl: url, actorPersonId: owner };
  const accounts: string[] = [];
  const account = (email: string, emailProvesIdentity: boolean, displayName = "Synthetic") => {
    const authUserId = randomUUID(); accounts.push(authUserId);
    return { authUserId, email, displayName, emailProvesIdentity };
  };
  const invite = async (displayName: string, email: string, role: "member" | "organizer" = "member") => {
    const { invitationId } = await addCommonsPerson(trip, { displayName, email, role }, options);
    const [row] = await db.db.select().from(invitations).where(eq(invitations.id, invitationId!));
    return { email, invitationId: invitationId!, personId: row!.provisionalPersonId, token: (await getCommonsInvitationLink(trip, invitationId!, options)).token };
  };
  const member = async (personId: string) => (await db.db.select().from(memberships).where(eq(memberships.personId, personId)))[0];
  const person = async (personId: string) => (await db.db.select().from(people).where(eq(people.id, personId)))[0];
  const cleanup = async () => {
    try {
      const provisional = (await db.db.select({ id: memberships.personId }).from(memberships).where(eq(memberships.commonsId, trip))).map(row => row.id);
      await db.db.delete(commons).where(eq(commons.id, trip));
      await db.db.delete(people).where(inArray(people.id, [owner, ...provisional]));
      if (accounts.length) await db.db.delete(people).where(inArray(people.authUserId, accounts));
    } finally { await db.close(); }
  };
  return { url, trip, options, account, invite, member, person, cleanup };
}

test("password sign-in: typing an invited person's email gets nothing; their private link is what accepts", { skip }, async () => {
  const f = await fixture();
  try {
    const casey = await f.invite("Casey", `casey-${randomUUID()}@example.com`);

    // Account B types Casey's address. No invitation is listed and no profile is claimed by it.
    const attacker = f.account(casey.email, false);
    assert.deepEqual(await listPendingCommonsInvitationsForIdentity(attacker, f.url), []);
    const attackerPerson = await findOrClaimPersonForAuthIdentity(attacker, f.url);
    assert.ok(attackerPerson);
    assert.notEqual(attackerPerson, casey.personId, "the typed address never claims the invited person");
    assert.equal((await f.person(casey.personId))!.authUserId, null);
    assert.equal((await f.member(casey.personId))!.status, "invited");
    // An organizer invitation is no different: the address alone never reaches organizer access.
    const riley = await f.invite("Riley", `riley-${randomUUID()}@example.com`, "organizer");
    const rileyTyper = f.account(riley.email, false);
    assert.deepEqual(await listPendingCommonsInvitationsForIdentity(rileyTyper, f.url), []);
    const rileyTyperPerson = await findOrClaimPersonForAuthIdentity(rileyTyper, f.url);
    assert.ok(rileyTyperPerson); assert.notEqual(rileyTyperPerson, riley.personId);
    assert.equal(await getCommonsPeople(f.trip, { databaseUrl: f.url, actorPersonId: rileyTyperPerson }), null, "no organizer access");

    // Whoever holds the private link may accept, whatever address they typed.
    const linkHolder = f.account(`someone-else-${randomUUID()}@example.com`, false, "Casey M");
    assert.equal(await claimCommonsInvitation(casey.token, linkHolder, f.url), f.trip);
    assert.equal((await f.person(casey.personId))!.authUserId, linkHolder.authUserId);
    assert.equal((await f.person(casey.personId))!.displayName, "Casey M", "the name the account chose arrives with the link");
    assert.equal((await f.member(casey.personId))!.status, "active");

    // An organizer invitation accepted by its link holder makes them an organizer, with no address check.
    const organizerHolder = f.account(`another-${randomUUID()}@example.com`, false, "Riley");
    assert.deepEqual(await findOrClaimPersonForInvitationLink(riley.token, organizerHolder, f.url), { status: "claimed", personId: riley.personId });
    assert.equal(await claimCommonsInvitation(riley.token, organizerHolder, f.url), f.trip);
    const rileyMember = await f.member(riley.personId);
    assert.equal(rileyMember!.status, "active"); assert.equal(rileyMember!.role, "organizer");

    // The account that only typed the address still gets nothing, even after the link holder joined.
    assert.equal(await findPersonIdForAuthUser(attacker.authUserId, f.url), attackerPerson);
    assert.equal((await f.member(attackerPerson)), undefined);
  } finally { await f.cleanup(); }
});

test("password sign-in: an account arriving through a private link becomes that person before accepting; a used or unknown link places nobody", { skip }, async () => {
  const f = await fixture();
  try {
    const email = `sam-${randomUUID()}@example.com`;
    const sam = await f.invite("Sam", email);
    const arriving = f.account(`typed-${randomUUID()}@example.com`, false, "Sam L");
    assert.deepEqual(await findOrClaimPersonForInvitationLink(sam.token, arriving, f.url), { status: "claimed", personId: sam.personId });
    assert.deepEqual(await findOrClaimPersonForInvitationLink(sam.token, arriving, f.url), { status: "claimed", personId: sam.personId }, "repeat is stable");
    assert.equal((await f.person(sam.personId))!.displayName, "Sam L");
    assert.equal((await f.member(sam.personId))!.status, "invited", "becoming the person is not accepting the invitation");
    assert.equal(await claimCommonsInvitation(sam.token, arriving, f.url), f.trip);
    const late = f.account(email, false);
    assert.deepEqual(await findOrClaimPersonForInvitationLink(sam.token, late, f.url), { status: "unavailable" });
    assert.deepEqual(await findOrClaimPersonForInvitationLink("not-a-real-token", late, f.url), { status: "unavailable" });
  } finally { await f.cleanup(); }
});

test("password sign-in: a managed traveler is claimed only through the link, never by the typed address", { skip }, async () => {
  const f = await fixture();
  try {
    const email = `maya-${randomUUID()}@example.com`;
    const added = await addCommonsPerson(f.trip, { displayName: "Maya", accessMode: "managed", email: null }, f.options);
    const maya = added.personId!;
    const prepared = await inviteManagedTraveler(f.trip, maya, { displayName: "Maya", email }, f.options);
    const token = (await getCommonsInvitationLink(f.trip, prepared.invitationId, f.options)).token;
    const typer = f.account(email, false);
    assert.notEqual(await findOrClaimPersonForAuthIdentity(typer, f.url), maya);
    assert.equal((await f.person(maya))!.authUserId, null);
    const holder = f.account(`maya-other-${randomUUID()}@example.com`, false);
    assert.deepEqual(await findOrClaimPersonForInvitationLink(token, holder, f.url), { status: "managed" });
    assert.equal(await findPersonIdForAuthUser(holder.authUserId, f.url), null, "no separate profile is made before accepting");
    assert.equal(await claimCommonsInvitation(token, holder, f.url), f.trip);
    assert.equal((await f.person(maya))!.authUserId, holder.authUserId);
    assert.equal((await f.member(maya))!.accessMode, "account");
  } finally { await f.cleanup(); }
});

test("emailed sign-in links are unchanged: a confirmed address finds and claims the invited person, and organizers need it", { skip }, async () => {
  const f = await fixture();
  try {
    const email = `link-${randomUUID()}@example.com`;
    const invited = await f.invite("Link traveler", email);
    const confirmed = f.account(email, true);
    const listed = await listPendingCommonsInvitationsForIdentity(confirmed, f.url);
    assert.equal(listed.length, 1); assert.equal(listed[0]!.token, invited.token);
    assert.equal((await listPendingCommonsInvitationsForIdentity({ authUserId: randomUUID(), email }, f.url)).length, 1, "left out, the flag counts as true");
    assert.equal(await findOrClaimPersonForAuthIdentity(confirmed, f.url), invited.personId);
    assert.equal(await claimCommonsInvitation(invited.token, confirmed, f.url), f.trip);
    const organizerEmail = `link-organizer-${randomUUID()}@example.com`;
    const organizer = await f.invite("Link organizer", organizerEmail, "organizer");
    await assert.rejects(claimCommonsInvitation(organizer.token, f.account(`wrong-${randomUUID()}@example.com`, true), f.url), /invited email/);
    assert.equal(await claimCommonsInvitation(organizer.token, f.account(organizerEmail, true), f.url), f.trip);
  } finally { await f.cleanup(); }
});
