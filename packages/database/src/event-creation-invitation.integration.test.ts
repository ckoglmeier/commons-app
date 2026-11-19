import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import {
  commitEventCreationDraft,
  createEventCreationDraft,
  getEventCreationDraft,
  updateEventCreationDraftPeople,
} from "./event-creation-repository";
import {
  claimCommonsInvitation,
  getCommonsInvitationLink,
  getCommonsInvitationPreview,
  listPendingCommonsInvitationsForIdentity,
} from "./onboarding-repository";
import { commons, invitations, people } from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

test("an invitation created by the event flow can be claimed", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL or DATABASE_URL is required");
  assert.ok(process.env.COMMONS_INVITATION_TOKEN_KEY, "COMMONS_INVITATION_TOKEN_KEY is required");

  const suffix = randomUUID().slice(0, 8);
  const recipientEmail = `traveler-${suffix}@example.com`;
  const database = createDatabase(databaseUrl);
  const createdPersonIds: string[] = [];
  let createdCommonsId: string | null = null;

  try {
    const [organizer] = await database.db.insert(people).values({
      displayName: "Event Flow Organizer",
    }).returning({ id: people.id });
    createdPersonIds.push(organizer.id);
    const options = { databaseUrl, actorPersonId: organizer.id };

    let draft = await createEventCreationDraft({
      sourceKind: "description",
      title: `Denver trip ${suffix}`,
      timezone: "America/Denver",
    }, options);
    draft = await updateEventCreationDraftPeople(draft.id, {
      expectedVersion: draft.version,
      people: [{
        id: randomUUID(),
        personId: null,
        displayName: "Event Flow Traveler",
        email: recipientEmail,
        message: "Join the trip.",
        included: true,
      }],
    }, options);

    const committed = await commitEventCreationDraft(draft.id, {
      commandId: randomUUID(),
      expectedVersion: draft.version,
    }, options);
    createdCommonsId = committed.eventId;
    assert.equal(committed.unsentInvitationCount, 1);

    const [invitation] = await database.db.select({
      id: invitations.id,
      personId: invitations.provisionalPersonId,
    }).from(invitations).where(eq(invitations.commonsId, committed.eventId)).limit(1);
    assert.ok(invitation);
    createdPersonIds.push(invitation.personId);

    const link = await getCommonsInvitationLink(committed.slug, invitation.id, options);
    assert.equal((await getCommonsInvitationPreview(link.token, databaseUrl))?.status, "pending");
    const travelerIdentity = {
      authUserId: randomUUID(),
      email: recipientEmail.toUpperCase(),
    };
    const pendingInvitations = await listPendingCommonsInvitationsForIdentity(travelerIdentity, databaseUrl);
    assert.equal(pendingInvitations.length, 1);
    assert.equal(pendingInvitations[0].commons.id, committed.eventId);
    assert.equal((await getCommonsInvitationPreview(pendingInvitations[0].token, databaseUrl))?.status, "pending");
    assert.equal(await claimCommonsInvitation(pendingInvitations[0].token, travelerIdentity, databaseUrl), committed.slug);
  } finally {
    if (createdCommonsId) {
      await database.db.delete(commons).where(eq(commons.id, createdCommonsId));
    }
    if (createdPersonIds.length) {
      await database.db.delete(people).where(inArray(people.id, createdPersonIds));
    }
    await database.close();
  }
});


test("generic title-only trips retain an empty place through draft reload and commit", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl);
  const database = createDatabase(databaseUrl);
  const [organizer] = await database.db.insert(people).values({ displayName: "Title Only Organizer" }).returning();
  const createdIds: string[] = [];
  try {
    const options = { databaseUrl, actorPersonId: organizer.id };
    for (const title of ["QA weekend with friends", "Family vacation"]) {
      const draft = await createEventCreationDraft({ sourceKind: "description", title, timezone: "America/Denver" }, options);
      assert.equal(draft.locationName, null);
      assert.equal((await getEventCreationDraft(draft.id, options)).locationName, null);
      const committed = await commitEventCreationDraft(draft.id, { commandId: randomUUID(), expectedVersion: draft.version }, options);
      createdIds.push(committed.eventId);
      const [saved] = await database.db.select().from(commons).where(eq(commons.id, committed.eventId));
      assert.equal(saved.name, title);
      assert.equal(saved.locationName, null, "commit never substitutes the title for the optional place");
    }
  } finally {
    if (createdIds.length) await database.db.delete(commons).where(inArray(commons.id, createdIds));
    await database.db.delete(people).where(eq(people.id, organizer.id));
    await database.close();
  }
});
