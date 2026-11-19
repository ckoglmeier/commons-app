import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { addCommonsItineraryItem, addCommonsStay, getCommonsSnapshot, setCommonsPlacePin, updateCommonsItineraryItem, updateCommonsStay } from "./pilot-repository";
import { commons, memberships, people } from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

test("stays and activities keep a saved map pin until someone changes it", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL or DATABASE_URL is required");
  const database = createDatabase(databaseUrl);
  const personIds: string[] = [];
  let commonsId: string | undefined;
  try {
    const inserted = await database.db.insert(people).values([
      { displayName: "Pin Organizer", authUserId: randomUUID() },
      { displayName: "Pin Traveler", authUserId: randomUUID() },
    ]).returning({ id: people.id });
    personIds.push(...inserted.map(person => person.id));
    const [event] = await database.db.insert(commons).values({
      slug: `pins-${randomUUID().slice(0, 8)}`, name: "Pin Test", startsOn: "2027-11-05", endsOn: "2027-11-07",
      timezone: "America/Los_Angeles", createdByPersonId: personIds[0]!,
    }).returning({ id: commons.id, slug: commons.slug });
    assert.ok(event);
    commonsId = event.id;
    await database.db.insert(memberships).values([
      { commonsId, personId: personIds[0]!, status: "active", role: "organizer" },
      { commonsId, personId: personIds[1]!, status: "active", role: "member" },
    ]);
    const organizer = { databaseUrl, actorPersonId: personIds[0]! }, traveler = { databaseUrl, actorPersonId: personIds[1]! };
    const lodgePin = { latitude: 38.2797, longitude: -122.4585, precision: "exact" as const, source: "page" as const };
    const stayFields = {
      name: "The Lodge at Sonoma", address: "1325 Broadway, Sonoma, CA", startsOn: "2027-11-05", endsOn: "2027-11-07",
      checkInTime: null, checkOutTime: null, status: "considering" as const, includedPersonIds: personIds,
      bookingUrl: "https://example.com/lodge", pollId: null, confirmationCode: null, details: null,
    };
    const added = await addCommonsStay(event.slug, { ...stayFields, commandId: randomUUID(), pin: lodgePin }, organizer);
    const stay = added?.state.stays?.[0];
    assert.ok(stay);
    assert.deepEqual(stay.pin, lodgePin);

    // Other stay edits that do not mention a pin keep it.
    const renamed = await updateCommonsStay(event.slug, stay.id, { ...stayFields, commandId: randomUUID(), name: "Lodge at Sonoma" }, organizer);
    assert.deepEqual(renamed?.state.stays?.[0]?.pin, lodgePin);

    // A rental's area pin stays approximate.
    const rental = await addCommonsStay(event.slug, { ...stayFields, commandId: randomUUID(), name: "Glen Ellen house", address: "Glen Ellen area",
      pin: { latitude: 38.3644, longitude: -122.5242, precision: "approximate", source: "placed" } }, organizer);
    assert.equal(rental?.state.stays?.find(item => item.name === "Glen Ellen house")?.pin?.precision, "approximate");

    // An option being considered can be just a name and a link; a planned stay needs its address.
    const option = await addCommonsStay(event.slug, { ...stayFields, commandId: randomUUID(), name: "Cottage listing", address: "", bookingUrl: "https://example.com/cottage" }, organizer);
    assert.equal(option?.state.stays?.find(item => item.name === "Cottage listing")?.address, "");
    await assert.rejects(addCommonsStay(event.slug, { ...stayFields, commandId: randomUUID(), name: "Planned, no address", address: "", status: "planned" }, organizer), /address/);

    // A hotel option priced per room keeps that price through unrelated edits; a room count makes a group total.
    const quoted = await addCommonsStay(event.slug, { ...stayFields, commandId: randomUUID(), name: "Valley Inn", roomPriceCents: 77_641, includesTaxesAndFees: true }, organizer);
    const inn = quoted?.state.stays?.find(item => item.name === "Valley Inn");
    assert.ok(inn);
    assert.equal(inn.roomPriceCents, 77_641);
    assert.equal(inn.totalCents, undefined);
    const renamedInn = await updateCommonsStay(event.slug, inn.id, { ...stayFields, commandId: randomUUID(), name: "Sonoma Valley Inn", includesTaxesAndFees: true }, organizer);
    assert.equal(renamedInn?.state.stays?.find(item => item.id === inn.id)?.roomPriceCents, 77_641);
    const counted = await updateCommonsStay(event.slug, inn.id, { ...stayFields, commandId: randomUUID(), name: "Sonoma Valley Inn", roomCount: 4, totalCents: 77_641 * 4, costSource: "estimate", includesTaxesAndFees: true }, organizer);
    const countedInn = counted?.state.stays?.find(item => item.id === inn.id);
    assert.deepEqual([countedInn?.roomPriceCents, countedInn?.roomCount, countedInn?.totalCents], [77_641, 4, 310_564]);

    // Only organizers manage stays, including their pins.
    await assert.rejects(setCommonsPlacePin(event.slug, { commandId: randomUUID(), kind: "stay", id: stay.id, pin: null }, traveler), /organizer/);

    const activity = await addCommonsItineraryItem(event.slug, {
      commandId: randomUUID(), title: "Gundlach Bundschu", date: null, time: null, location: "2000 Denmark St, Sonoma, CA",
      participantScope: "everyone", sourceUrl: "https://example.com/gunbun", occurredAt: new Date().toISOString(),
    }, traveler);
    const idea = activity?.state.itinerary.find(item => item.title === "Gundlach Bundschu");
    assert.ok(idea);
    assert.equal(idea.status, "idea");
    assert.equal(idea.pin, undefined);

    // Any active participant can place an activity on the map.
    const placed = { latitude: 38.2933, longitude: -122.4258, precision: "exact" as const, source: "placed" as const };
    const pinCommand = { commandId: randomUUID(), kind: "activity", id: idea.id, pin: placed };
    const pinned = await setCommonsPlacePin(event.slug, pinCommand, traveler);
    assert.deepEqual(pinned?.state.itinerary.find(item => item.id === idea.id)?.pin, placed);
    // Replaying the same command changes nothing further.
    await setCommonsPlacePin(event.slug, { ...pinCommand, pin: null }, traveler);
    assert.deepEqual((await getCommonsSnapshot(event.slug, traveler))?.state.itinerary.find(item => item.id === idea.id)?.pin, placed);

    const edited = await updateCommonsItineraryItem(event.slug, idea.id, {
      commandId: randomUUID(), title: "Gundlach Bundschu Winery", date: "2027-11-06", time: null, location: "2000 Denmark St, Sonoma, CA",
      participantScope: "everyone", occurredAt: new Date().toISOString(),
    }, traveler);
    assert.deepEqual(edited?.state.itinerary.find(item => item.id === idea.id)?.pin, placed);

    const removed = await setCommonsPlacePin(event.slug, { commandId: randomUUID(), kind: "activity", id: idea.id, pin: null }, traveler);
    assert.equal(removed?.state.itinerary.find(item => item.id === idea.id)?.pin, undefined);

    // An id from another trip is not reachable.
    await assert.rejects(setCommonsPlacePin(event.slug, { commandId: randomUUID(), kind: "activity", id: randomUUID(), pin: placed }, traveler), /no longer available/);
  } finally {
    if (commonsId) await database.db.delete(commons).where(eq(commons.id, commonsId));
    if (personIds.length) await database.db.delete(people).where(inArray(people.id, personIds));
    await database.close();
  }
});
