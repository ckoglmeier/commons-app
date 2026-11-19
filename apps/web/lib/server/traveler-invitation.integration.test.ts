import test from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { addCommonsPerson, people } from "@commons/database";
import { registerComponentImportStubs } from "../test-support/hook-harness";
import { actAs, databaseTestsEnabled, seedSyntheticTrip, testDatabaseUrl, withTestDatabase } from "../test-support/database-harness";
registerComponentImportStubs();

test("People auto-send preserves failed travelers, gates organizers and leaves older invites unchanged", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip();
  const keys = ["NEXT_PUBLIC_SITE_URL", "COMMONS_EMAIL_SEND_MODE", "SUPABASE_SERVICE_ROLE_KEY"];
  const environment = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const createdIds = new Set<string>();
  const existingIds = new Set([trip.organizerId, trip.coOrganizerId, trip.travelerId]);
  globalThis.fetch = async () => { assert.fail("The local integration test must not contact a provider."); };
  actAs(trip.organizerId);
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:4314";
  process.env.COMMONS_EMAIL_SEND_MODE = "disabled";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const { addAuthenticatedCommonsPerson, inviteAuthenticatedManagedTraveler, sendAuthenticatedCommonsInvitation, loadAuthenticatedCommonsPeople } = await import("./commons");
    const options = { databaseUrl: testDatabaseUrl(), actorPersonId: trip.organizerId };
    const old = await addCommonsPerson(trip.eventId, { displayName: "Old pending traveler", email: `${trip.eventId}-old@example.com`, role: "member", accessMode: "account" }, options);
    const input = { displayName: "New traveler", email: `${trip.eventId}-new@example.com`, role: "member", accessMode: "account" };
    const saved = await addAuthenticatedCommonsPerson(trip.eventId, input, "http://localhost:4314");
    const traveler = saved.people.find(person => person.email === input.email)!;
    saved.people.forEach(person => { if (!existingIds.has(person.personId)) createdIds.add(person.personId); });
    assert.equal(traveler.membershipStatus, "invited");
    assert.equal(traveler.invitation?.deliveryState, "failed", "failed delivery must preserve the saved traveler and a retryable invitation");
    assert.equal(saved.people.find(person => person.invitation?.id === old.invitationId)?.invitation?.deliveryState, "not_sent");
    await assert.rejects(addAuthenticatedCommonsPerson(trip.eventId, input, "http://localhost:4314"), /already belongs/);

    const gated = await addAuthenticatedCommonsPerson(trip.eventId, { ...input, role: "organizer", displayName: "New organizer", email: `${trip.eventId}-organizer@example.com` }, "http://localhost:4314");
    const organizer = gated.people.find(person => person.displayName === "New organizer")!;
    createdIds.add(organizer.personId);
    assert.equal(organizer.invitation?.deliveryState, "not_sent");
    assert.equal(organizer.membershipStatus, "invited");
    const sentExplicitly = await sendAuthenticatedCommonsInvitation(trip.eventId, organizer.invitation!.id, "http://localhost:4314");
    assert.equal(sentExplicitly?.deliveryState, "failed", "the explicit organizer Send path remains available");

    const fallback = await addAuthenticatedCommonsPerson(trip.eventId, { ...input, displayName: "Origin fallback traveler", email: `${trip.eventId}-fallback@example.com` });
    const fallbackTraveler = fallback.people.find(person => person.displayName === "Origin fallback traveler")!;
    createdIds.add(fallbackTraveler.personId);
    assert.equal(fallbackTraveler.invitation?.deliveryState, "failed", "the configured local site origin also drains the newly queued attempt");

    const managedRoster = await addAuthenticatedCommonsPerson(trip.eventId, { displayName: "Managed traveler", role: "member", accessMode: "managed" });
    const managed = managedRoster.people.find(person => person.displayName === "Managed traveler")!;
    createdIds.add(managed.personId);
    assert.equal(managed.invitation, null);
    const invited = await inviteAuthenticatedManagedTraveler(trip.eventId, managed.personId, { displayName: "Managed traveler", email: `${trip.eventId}-managed@example.com`, message: null }, "http://localhost:4314");
    const claimed = invited.people.find(person => person.personId === managed.personId)!;
    assert.equal(claimed.invitation?.deliveryState, "failed");
    assert.equal(claimed.accessMode, "managed", "sending an invite does not accept or claim the existing traveler");
    const final = await loadAuthenticatedCommonsPeople(trip.eventId);
    final.people.forEach(person => { if (!existingIds.has(person.personId)) createdIds.add(person.personId); });
    assert.equal(final.people.find(person => person.invitation?.id === old.invitationId)?.invitation?.deliveryState, "not_sent");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(environment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await trip.cleanup();
    if (createdIds.size) await withTestDatabase(db => db.delete(people).where(inArray(people.id, [...createdIds])));
  }
});
