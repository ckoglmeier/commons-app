import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../../packages/database/src/client";
import { commons, memberships, people, itineraryItems } from "../../../packages/database/src/schema";
import { addCommonsItineraryItem, getCommonsSnapshot, updateCommonsItineraryItem } from "../../../packages/database/src/pilot-repository";

test("meal types persist, edits preserve omitted type, and invalid types are rejected", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(databaseUrl).hostname, "127.0.0.1");
  assert.ok(new URL(databaseUrl).pathname.endsWith("_test"));
  const database = createDatabase(databaseUrl);
  const actor = randomUUID(), event = randomUUID(), slug = `meal-${event}`;
  const options = { databaseUrl, actorPersonId: actor };
  try {
    await database.db.insert(people).values({ id: actor, displayName: "Meal QA", authUserId: randomUUID() });
    await database.db.insert(commons).values({ id: event, slug, name: "Meal QA", timezone: "UTC", createdByPersonId: actor });
    await database.db.insert(memberships).values({ commonsId: event, personId: actor, role: "organizer", status: "active" });
    for (const mealType of ["restaurant", "home"] as const) {
      const command = { commandId: randomUUID(), title: `Dinner ${mealType}`, mealType, date: null, time: null, location: "Reviewed location", note: "Meal notes", participantScope: "everyone", occurredAt: new Date().toISOString() };
      await addCommonsItineraryItem(slug, command, options);
      await addCommonsItineraryItem(slug, command, options);
      const saved = (await getCommonsSnapshot(slug, options))!.state.itinerary.filter(item => item.title === command.title);
      assert.equal(saved.length, 1);
      assert.equal(saved[0].mealType, mealType);
      assert.equal(saved[0].status, "idea");
      assert.equal(saved[0].startsAt, null);
      assert.equal(saved[0].scheduledDate, null);
      await updateCommonsItineraryItem(slug, saved[0].id, { ...command, commandId: randomUUID(), date: "2026-12-20", time: null }, options);
      const scheduled = (await getCommonsSnapshot(slug, options))!.state.itinerary.find(item => item.id === saved[0].id)!;
      assert.equal(scheduled.scheduledDate, "2026-12-20");
      assert.equal(scheduled.startsAt, null, "choosing a day does not invent a time");
      assert.equal(scheduled.mealType, mealType);
      const { mealType: omitted, ...legacy } = command;
      assert.equal(omitted, mealType);
      await updateCommonsItineraryItem(slug, saved[0].id, { ...legacy, commandId: randomUUID(), note: "Edited by legacy client" }, options);
      assert.equal((await getCommonsSnapshot(slug, options))!.state.itinerary.find(item => item.id === saved[0].id)!.mealType, mealType);
      const switched = mealType === "home" ? "restaurant" : "home";
      await updateCommonsItineraryItem(slug, saved[0].id, { ...command, mealType: switched, commandId: randomUUID() }, options);
      assert.equal((await getCommonsSnapshot(slug, options))!.state.itinerary.find(item => item.id === saved[0].id)!.mealType, switched);
      await assert.rejects(addCommonsItineraryItem(slug, { ...command, commandId: randomUUID(), mealType: "invalid" }, options));
      await assert.rejects(database.db.update(itineraryItems).set({ mealType: "invalid" as "home" }).where(eq(itineraryItems.id, saved[0].id)));
      await updateCommonsItineraryItem(slug, saved[0].id, { ...command, mealType: null, commandId: randomUUID() }, options);
      assert.equal((await getCommonsSnapshot(slug, options))!.state.itinerary.find(item => item.id === saved[0].id)!.mealType, undefined);
    }
  } finally {
    await database.db.delete(commons).where(eq(commons.id, event));
    await database.db.delete(people).where(eq(people.id, actor));
    await database.close();
  }
});

test("restaurant confirmation is private per person, preserved by shared edits, and optional before adding cost", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(databaseUrl).hostname, "127.0.0.1");
  assert.ok(new URL(databaseUrl).pathname.endsWith("_test"));
  const database = createDatabase(databaseUrl);
  const actor = randomUUID(), other = randomUUID(), event = randomUUID(), slug = `reservation-${event}`;
  const options = { databaseUrl, actorPersonId: actor }, otherOptions = { databaseUrl, actorPersonId: other };
  try {
    await database.db.insert(people).values([{ id: actor, displayName: "Meal owner", authUserId: randomUUID() }, { id: other, displayName: "Other organizer", authUserId: randomUUID() }]);
    await database.db.insert(commons).values({ id: event, slug, name: "Reservation QA", timezone: "UTC", createdByPersonId: actor });
    await database.db.insert(memberships).values([{ commonsId: event, personId: actor, role: "member", status: "active" }, { commonsId: event, personId: other, role: "organizer", status: "active" }]);
    const command = { commandId: randomUUID(), title: "Dinner idea", mealType: "restaurant", date: null, time: null, participantScope: "everyone", occurredAt: new Date().toISOString() };
    const reservation = { number: "PRIVATE-123", note: "PRIVATE special request" };
    await addCommonsItineraryItem(slug, { ...command, mealReservation: reservation }, options);
    await addCommonsItineraryItem(slug, { ...command, mealReservation: reservation }, options);
    const mine = (await getCommonsSnapshot(slug, options))!.state.itinerary[0];
    assert.deepEqual(mine.mealReservation, reservation);
    await assert.rejects(updateCommonsItineraryItem(slug, mine.id, { ...command, commandId: randomUUID(), mealType: null, mealReservation: reservation }, options));
    assert.equal(mine.expectedCostCents, undefined);
    assert.doesNotMatch(JSON.stringify(await getCommonsSnapshot(slug, otherOptions)), /PRIVATE/);
    await updateCommonsItineraryItem(slug, mine.id, { ...command, commandId: randomUUID(), note: "Shared edited note" }, otherOptions);
    assert.deepEqual((await getCommonsSnapshot(slug, options))!.state.itinerary[0].mealReservation, reservation);
    await updateCommonsItineraryItem(slug, mine.id, { ...command, commandId: randomUUID(), mealReservation: { number: "OTHER-456", note: "Other reservation" } }, otherOptions);
    assert.deepEqual((await getCommonsSnapshot(slug, options))!.state.itinerary[0].mealReservation, reservation);
    assert.equal((await getCommonsSnapshot(slug, otherOptions))!.state.itinerary[0].mealReservation?.number, "OTHER-456");
    await updateCommonsItineraryItem(slug, mine.id, { ...command, commandId: randomUUID(), mealReservation: null }, options);
    assert.equal((await getCommonsSnapshot(slug, options))!.state.itinerary[0].mealReservation, undefined);
    assert.equal((await getCommonsSnapshot(slug, otherOptions))!.state.itinerary[0].mealReservation?.number, "OTHER-456");
  } finally {
    await database.db.delete(commons).where(eq(commons.id, event));
    await database.db.delete(people).where(eq(people.id, actor));
    await database.db.delete(people).where(eq(people.id, other));
    await database.close();
  }
});
