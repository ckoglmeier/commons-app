import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { auditEvents, commons, expenses, groupInvitations, invitations, memberships, people, processedCommands } from "./schema";
import { getGroupInvitation, getGroupInvitationPreview, joinGroupInvitation, manageGroupInvitation } from "./group-invitation-repository";
import { addCommonsPerson, getCommonsInvitationLink, getCommonsInvitationPreview, inviteManagedTraveler, revokeCommonsInvitation } from "./onboarding-repository";
const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";

test("group links bind reviewed traveler scope, rotate/revoke/expire, and safely reconcile concurrent verified joins", { skip }, async () => {
  const url = process.env.TEST_DATABASE_URL!; assert.equal(new URL(url).hostname, "127.0.0.1"); assert.ok(new URL(url).pathname.endsWith("_test"));
  const database = createDatabase(url), db = database.db, trip = randomUUID(), org = randomUUID(), member = randomUUID(), created = new Set<string>([org, member]);
  const options = { databaseUrl: url, actorPersonId: org }, identity = (authUserId = randomUUID(), name = "Same display name") => ({ authUserId, displayName: name, email: `${authUserId}@example.com` });
  const track = async (authId: string) => { const [row] = await db.select().from(people).where(eq(people.authUserId, authId)); if (row) created.add(row.id); return row; };
  const add = async (input: unknown) => {
    const result = await addCommonsPerson(trip, input, options);
    const personId = result.personId ?? (await db.select().from(invitations).where(eq(invitations.id, result.invitationId!)))[0].provisionalPersonId;
    created.add(personId); return { ...result, personId };
  };
  try {
    await db.insert(people).values([{ id: org, authUserId: org, displayName: "Organizer" }, { id: member, authUserId: member, displayName: "Member" }]);
    await db.insert(commons).values({ id: trip, slug: trip, name: "Synthetic group invitation", createdByPersonId: org, status: "planning", timezone: "America/Denver" });
    await db.insert(memberships).values([{ commonsId: trip, personId: org, role: "organizer", status: "active" }, { commonsId: trip, personId: member, role: "member", status: "active" }]);
    assert.equal(await getGroupInvitation(trip, options), null);
    const create = { commandId: randomUUID(), expectedVersion: 0, action: "create", scopeAccepted: true, expiresInDays: 14 };
    await assert.rejects(manageGroupInvitation(trip, { ...create, scopeAccepted: false }, options));
    await assert.rejects(manageGroupInvitation(trip, { ...create, role: "organizer" }, options));
    await assert.rejects(manageGroupInvitation(trip, create, { ...options, actorPersonId: member }));
    let link = (await manageGroupInvitation(trip, create, options))!;
    assert.equal(link.state, "active"); assert.match(link.token!, /^g_[A-Za-z0-9_-]{32}$/);
    assert.equal((await manageGroupInvitation(trip, create, options))!.token, link.token, "lost-success create retry retains the same link");
    const token = link.token!, preview = (await getGroupInvitationPreview(token, url))!;
    assert.deepEqual(Object.keys(preview).sort(), ["tripId", "linkId", "version", "tripName", "inviterName", "expiresAt"].sort());
    await db.update(commons).set({ name: "Renamed synthetic trip" }).where(eq(commons.id, trip));
    const renamed = (await getGroupInvitationPreview(token, url))!;
    assert.equal(renamed.tripId, trip); assert.equal(renamed.tripName, "Renamed synthetic trip");
    assert.equal((await getGroupInvitation(trip, options))!.token, token, "renaming never changes the trip UUID or credential");
    for (const role of ["anon", "authenticated"]) {
      await assert.rejects(db.transaction(async tx => { await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`)); await tx.select().from(groupInvitations); }));
    }
    await assert.rejects(db.transaction(async tx => {
      await tx.execute(sql`grant select on group_invitations to authenticated`);
      await tx.execute(sql`set local role authenticated`);
      assert.deepEqual(await tx.select().from(groupInvitations), [], "RLS denies credentials even with an accidental SELECT grant");
      throw new Error("rollback temporary test grant");
    }), /rollback temporary test grant/);
    const joinInput = (version = link.version) => ({ commandId: randomUUID(), tripId: trip, linkId: link.id, version });
    const first = identity(), request = joinInput();
    const joined = await Promise.all([joinGroupInvitation(token, first, request, url), joinGroupInvitation(token, first, request, url)]);
    assert.deepEqual(joined[0], joined[1]);
    const person = await track(first.authUserId);
    const [joinedMember] = await db.select().from(memberships).where(and(eq(memberships.commonsId, trip), eq(memberships.personId, person.id)));
    assert.equal(joinedMember.role, "member"); assert.equal(joinedMember.attendanceState, "helping"); assert.equal(joinedMember.attendanceDates, null);
    assert.equal((await db.select().from(auditEvents).where(and(eq(auditEvents.commonsId, trip), eq(auditEvents.action, "membership.group_link_joined")))).length, 1);
    assert.equal((await joinGroupInvitation(token, first, joinInput(), url)).alreadyMember, true);
    await assert.rejects(joinGroupInvitation(token, identity(), { ...joinInput(), tripId: randomUUID() }, url));
    await assert.rejects(joinGroupInvitation(token, first, { ...joinInput(), role: "organizer" }, url));
    const another = identity(); await joinGroupInvitation(token, another, joinInput(), url); const other = await track(another.authUserId);
    assert.notEqual(person.id, other.id, "identical display names do not merge profiles");
    assert.equal((await joinGroupInvitation(token, identity(org, "Organizer"), joinInput(), url)).alreadyMember, true);
    assert.equal((await db.select().from(memberships).where(and(eq(memberships.commonsId, trip), eq(memberships.personId, org))))[0].role, "organizer", "a repeat does not demote an existing organizer");

    const recipient = identity(), individual = await add({ displayName: "Invited traveler", email: recipient.email, accessMode: "account", role: "member" });
    created.add(individual.personId);
    const personal = await getCommonsInvitationLink(trip, individual.invitationId!, options);
    assert.equal(await getGroupInvitationPreview(personal.token, url), null);
    assert.equal(await getCommonsInvitationPreview(token, url), null, "a group token is not a personal claim token");
    await joinGroupInvitation(token, recipient, joinInput(), url);
    assert.equal((await track(recipient.authUserId)).id, individual.personId, "verified email uses the existing safe identity record");
    assert.equal((await db.select().from(invitations).where(eq(invitations.id, individual.invitationId!)))[0].status, "accepted");

    const pendingOrg = identity(), orgInvite = await add({ displayName: "Pending organizer", email: pendingOrg.email, accessMode: "account", role: "organizer" });
    created.add(orgInvite.personId);
    await assert.rejects(joinGroupInvitation(token, pendingOrg, joinInput(), url), /personal organizer invitation/);
    assert.equal((await db.select().from(memberships).where(and(eq(memberships.commonsId, trip), eq(memberships.personId, orgInvite.personId))))[0].status, "invited");

    const removed = identity(), removedInvite = await add({ displayName: "Removed invitee", email: removed.email, accessMode: "account" });
    created.add(removedInvite.personId); await revokeCommonsInvitation(trip, removedInvite.invitationId!, options);
    await assert.rejects(joinGroupInvitation(token, removed, joinInput(), url), /withdrawn/);
    await db.update(memberships).set({ attendanceState: "declined" }).where(eq(memberships.id, joinedMember.id));
    await assert.rejects(joinGroupInvitation(token, first, joinInput(), url), /withdrawn/);

    const managedIdentity = identity(), managed = await add({ displayName: "Managed traveler", accessMode: "managed", role: "member" });
    created.add(managed.personId); await inviteManagedTraveler(trip, managed.personId, { displayName: "Managed traveler", email: managedIdentity.email }, options);
    await assert.rejects(joinGroupInvitation(token, managedIdentity, joinInput(), url), /personal invitation/);
    assert.equal((await db.select().from(people).where(eq(people.id, managed.personId)))[0].authUserId, null, "group join does not silently claim a managed profile");

    const replacement = { commandId: randomUUID(), expectedVersion: link.version, action: "replace", scopeAccepted: true, expiresInDays: 7 };
    link = (await manageGroupInvitation(trip, replacement, options))!;
    assert.notEqual(link.token, token); assert.equal(await getGroupInvitationPreview(token, url), null);
    await assert.rejects(joinGroupInvitation(token, another, request, url), /no longer available/);
    assert.equal((await manageGroupInvitation(trip, create, options))!.token, link.token, "replaying old create cannot resurrect a rotated token");
    await assert.rejects(manageGroupInvitation(trip, { ...replacement, commandId: randomUUID() }, options));
    const activeToken = link.token!, revoke = { commandId: randomUUID(), expectedVersion: link.version, action: "revoke" };
    link = (await manageGroupInvitation(trip, revoke, options))!;
    assert.equal(link.state, "revoked"); assert.equal(link.token, null); assert.equal(await getGroupInvitationPreview(activeToken, url), null);
    assert.equal((await manageGroupInvitation(trip, revoke, options))!.state, "revoked");
    assert.equal((await db.select().from(memberships).where(and(eq(memberships.commonsId, trip), eq(memberships.personId, other.id))))[0].status, "active", "disabling a link does not remove joined members");
    link = (await manageGroupInvitation(trip, { ...replacement, commandId: randomUUID(), expectedVersion: link.version }, options))!;
    await db.update(groupInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(groupInvitations.id, link.id));
    assert.equal((await getGroupInvitation(trip, options))!.state, "expired"); assert.equal(await getGroupInvitationPreview(link.token!, url), null);
    await assert.rejects(joinGroupInvitation(link.token!, another, joinInput(), url), /no longer available/);
    assert.equal((await db.select().from(expenses).where(eq(expenses.commonsId, trip))).length, 0);
    assert.doesNotMatch(JSON.stringify(await db.select().from(processedCommands).where(eq(processedCommands.commonsId, trip))), /g_[A-Za-z0-9_-]{32}/, "command receipts contain no bearer token");
  } finally { await db.delete(commons).where(eq(commons.id, trip)); await db.delete(people).where(inArray(people.id, [...created])); await database.close(); }
});
