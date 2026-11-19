import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import {
  addCommonsPerson,
  claimCommonsInvitation,
  createCommonsDraft,
  findOrClaimPersonForAuthIdentity,
  findPersonIdForAuthUser,
  getCommonsInvitationLink,
  getCommonsInvitationPreview,
  getCommonsPeople,
  listCommonsMembershipsForPerson,
  OnboardingRepositoryError,
  revokeCommonsInvitation,
  rotateCommonsInvitationLink,
  saveCommonsSetupTravelers,
  updateCommonsMemberRole,
  updateCommonsPendingInvitation,
} from "./onboarding-repository";
import { commons, invitations, people } from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

test("two authenticated identities can claim safely while old links are invalidated", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL or DATABASE_URL is required");
  assert.ok(process.env.COMMONS_INVITATION_TOKEN_KEY, "COMMONS_INVITATION_TOKEN_KEY is required");

  const suffix = randomUUID().slice(0, 8);
  const organizer = { authUserId: randomUUID(), email: `organizer-${suffix}@example.com` };
  const traveler = { authUserId: randomUUID(), email: `traveler-${suffix}@example.com` };
  const linkHolder = { authUserId: randomUUID(), phone: "+15135550148", displayName: "Link Holder" };
  const createdCommonsIds: string[] = [];
  const createdPersonIds: string[] = [];

  try {
    const firstTrip = await createCommonsDraft({
      organizerDisplayName: "Organizer Test",
      name: `Invitation Test ${suffix}`,
      startsOn: "2027-06-01",
      endsOn: "2027-06-04",
      locationName: "Denver, Colorado",
      timezone: "America/Denver",
    }, organizer, databaseUrl);
    createdCommonsIds.push(firstTrip.commonsId);
    const organizerPersonId = await findPersonIdForAuthUser(organizer.authUserId, databaseUrl);
    assert.ok(organizerPersonId);
    createdPersonIds.push(organizerPersonId);
    const options = { databaseUrl, actorPersonId: organizerPersonId };

    const coOrganizerEmail = `co-organizer-${suffix}@example.com`;
    await addCommonsPerson(firstTrip.slug, { displayName: "Co-organizer", email: coOrganizerEmail, role: "organizer" }, options);
    const coOrganizer = (await getCommonsPeople(firstTrip.slug, options))?.people.find(person => person.email === coOrganizerEmail);
    assert.ok(coOrganizer?.invitation);
    createdPersonIds.push(coOrganizer.personId);
    assert.equal(coOrganizer.role, "organizer");
    assert.equal(coOrganizer.membershipStatus, "invited");
    const coOptions = { databaseUrl, actorPersonId: coOrganizer.personId };
    assert.equal(await getCommonsPeople(firstTrip.slug, coOptions), null, "pending organizers have no organizer access");
    await assert.rejects(updateCommonsMemberRole(firstTrip.slug, organizerPersonId, { role: "member" }, coOptions));
    const coLink = await getCommonsInvitationLink(firstTrip.slug, coOrganizer.invitation.id, options);
    await updateCommonsMemberRole(firstTrip.slug, coOrganizer.personId, { role: "member" }, options);
    await updateCommonsMemberRole(firstTrip.slug, coOrganizer.personId, { role: "organizer" }, options);
    assert.equal((await getCommonsInvitationLink(firstTrip.slug, coOrganizer.invitation.id, options)).token, coLink.token);
    assert.equal((await getCommonsPeople(firstTrip.slug, options))?.people.find(person => person.personId === coOrganizer.personId)?.invitation?.deliveryState, "not_sent");
    await assert.rejects(claimCommonsInvitation(coLink.token, { authUserId: randomUUID(), email: "wrong@example.com" }, databaseUrl), /invited email/);
    await claimCommonsInvitation(coLink.token, { authUserId: randomUUID(), email: coOrganizerEmail }, databaseUrl);
    assert.equal((await getCommonsPeople(firstTrip.slug, coOptions))?.people.find(person => person.personId === coOrganizer.personId)?.role, "organizer");
    await assert.rejects(addCommonsPerson(firstTrip.slug, { displayName: "Managed organizer", accessMode: "managed", role: "organizer" }, options));

    await addCommonsPerson(firstTrip.slug, {
      displayName: "Traveler Test",
      email: traveler.email,
      message: "Come help us plan the weekend.",
    }, options);
    let peopleState = await getCommonsPeople(firstTrip.slug, options);
    assert.ok(peopleState);
    const invited = peopleState.people.find((person) => person.email === traveler.email);
    assert.ok(invited?.invitation);
    assert.equal(invited.invitation.message, "Come help us plan the weekend.");
    createdPersonIds.push(invited.personId);
    const link = await getCommonsInvitationLink(firstTrip.slug, invited.invitation.id, options);
    await saveCommonsSetupTravelers(firstTrip.slug, {
      travelers: [{ displayName: "Traveler Test Updated", email: traveler.email }],
    }, options);
    const preservedLink = await getCommonsInvitationLink(firstTrip.slug, invited.invitation.id, options);
    assert.equal(preservedLink.token, link.token, "resaving an unchanged traveler must preserve the invitation link");
    assert.equal(preservedLink.expiresAt, null);
    await updateCommonsPendingInvitation(firstTrip.slug, invited.invitation.id, {
      displayName: "Traveler Test Updated",
      email: traveler.email,
      message: "Updated note for the weekend.",
    }, options);
    assert.equal((await getCommonsInvitationPreview(link.token, databaseUrl))?.status, "pending");

    assert.equal(await claimCommonsInvitation(link.token, linkHolder, databaseUrl), firstTrip.slug);
    const mappedTravelerId = await findOrClaimPersonForAuthIdentity(linkHolder, databaseUrl);
    assert.equal(mappedTravelerId, invited.personId);
    const secondTrip = await createCommonsDraft({
      organizerDisplayName: "Traveler Test",
      name: `Second Trip ${suffix}`,
      startsOn: "2027-07-01",
      endsOn: "2027-07-04",
      locationName: "Boulder, Colorado",
      timezone: "America/Denver",
    }, linkHolder, databaseUrl);
    createdCommonsIds.push(secondTrip.commonsId);

    assert.equal(await claimCommonsInvitation(link.token, linkHolder, databaseUrl), firstTrip.slug);
    const memberships = await listCommonsMembershipsForPerson(invited.personId, databaseUrl);
    assert.deepEqual(
      new Set(memberships.map((membership) => membership.commons.slug)),
      new Set([firstTrip.slug, secondTrip.slug]),
    );
    peopleState = await getCommonsPeople(firstTrip.slug, options);
    assert.equal(peopleState?.people.find((person) => person.personId === invited.personId)?.membershipStatus, "active");

    await updateCommonsMemberRole(firstTrip.slug, invited.personId, { role: "organizer" }, options);
    peopleState = await getCommonsPeople(firstTrip.slug, options);
    assert.equal(peopleState?.people.find((person) => person.personId === invited.personId)?.role, "organizer");
    const travelerOptions = { databaseUrl, actorPersonId: invited.personId };
    assert.equal((await getCommonsPeople(firstTrip.slug, travelerOptions))?.currentPersonId, invited.personId);
    await assert.rejects(
      () => updateCommonsMemberRole(firstTrip.slug, invited.personId, { role: "member" }, travelerOptions),
      (error) => error instanceof OnboardingRepositoryError && error.code === "role_change_blocked",
    );
    await updateCommonsMemberRole(firstTrip.slug, invited.personId, { role: "member" }, options);
    assert.equal(await getCommonsPeople(firstTrip.slug, travelerOptions), null);

    await addCommonsPerson(firstTrip.slug, {
      displayName: "Rotation Test",
      email: `rotate-${suffix}@example.com`,
    }, options);
    peopleState = await getCommonsPeople(firstTrip.slug, options);
    const rotation = peopleState?.people.find((person) => person.email === `rotate-${suffix}@example.com`);
    assert.ok(rotation?.invitation);
    createdPersonIds.push(rotation.personId);
    const oldLink = await getCommonsInvitationLink(firstTrip.slug, rotation.invitation.id, options);
    const updatedRotationEmail = `rotate-updated-${suffix}@example.com`;
    await updateCommonsPendingInvitation(firstTrip.slug, rotation.invitation.id, {
      displayName: "Rotation Test",
      email: updatedRotationEmail,
    }, options);
    assert.equal(await getCommonsInvitationPreview(oldLink.token, databaseUrl), null);
    const editedLink = await getCommonsInvitationLink(firstTrip.slug, rotation.invitation.id, options);
    const newLink = await rotateCommonsInvitationLink(firstTrip.slug, rotation.invitation.id, options);
    assert.equal(await getCommonsInvitationPreview(editedLink.token, databaseUrl), null);
    assert.equal((await getCommonsInvitationPreview(newLink.token, databaseUrl))?.status, "pending");
    await revokeCommonsInvitation(firstTrip.slug, rotation.invitation.id, options);
    assert.equal(await getCommonsInvitationPreview(newLink.token, databaseUrl), null);

    await addCommonsPerson(firstTrip.slug, {
      displayName: "Expiry Test",
      email: `expired-${suffix}@example.com`,
      message: null,
    }, options);
    peopleState = await getCommonsPeople(firstTrip.slug, options);
    const expiry = peopleState?.people.find((person) => person.email === `expired-${suffix}@example.com`);
    assert.ok(expiry?.invitation);
    createdPersonIds.push(expiry.personId);
    const expiryDatabase = createDatabase(databaseUrl);
    try {
      await expiryDatabase.db.update(invitations).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(invitations.id, expiry.invitation.id));
    } finally {
      await expiryDatabase.close();
    }
    const durableLink = await getCommonsInvitationLink(firstTrip.slug, expiry.invitation.id, options);
    assert.equal(durableLink.expiresAt, null);
    assert.equal((await getCommonsInvitationPreview(durableLink.token, databaseUrl))?.status, "pending");
  } finally {
    const database = createDatabase(databaseUrl);
    try {
      if (createdCommonsIds.length) await database.db.delete(commons).where(inArray(commons.id, createdCommonsIds));
      if (createdPersonIds.length) await database.db.delete(people).where(inArray(people.id, createdPersonIds));
      await database.db.delete(people).where(eq(people.authUserId, linkHolder.authUserId));
    } finally {
      await database.close();
    }
  }
});
