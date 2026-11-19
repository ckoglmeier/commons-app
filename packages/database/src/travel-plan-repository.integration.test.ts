import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { addCommonsExpense, deleteCommonsExpense, deleteCommonsTravelPlan, getCommonsSnapshot, updateCommonsTravelPlanSharing, upsertCommonsFlightBooking, upsertCommonsTravelPlan } from "./pilot-repository";
import { travelPlans, commons, memberships, people } from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

test("saves a round-trip booking atomically without a flight cost and with one private confirmation", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL or DATABASE_URL is required");
  const database = createDatabase(databaseUrl);
  const personIds: string[] = [];
  let commonsId: string | undefined;
  try {
    const insertedPeople = await database.db.insert(people).values([
      { displayName: "Booking Owner", authUserId: randomUUID() },
      { displayName: "Booking Companion", authUserId: randomUUID() },
    ]).returning({ id: people.id });
    personIds.push(...insertedPeople.map((person) => person.id));
    const [event] = await database.db.insert(commons).values({
      slug: `booking-${randomUUID().slice(0, 8)}`,
      name: "Flight Booking Test",
      timezone: "America/Denver",
      createdByPersonId: personIds[0]!,
    }).returning({ id: commons.id, slug: commons.slug });
    assert.ok(event);
    commonsId = event.id;
    await database.db.insert(memberships).values(personIds.map((personId, index) => ({
      commonsId: event.id,
      personId,
      status: "active" as const,
      role: index === 0 ? "organizer" as const : "member" as const,
    })));
    const snapshot = await upsertCommonsFlightBooking(event.slug, {
      commandId: randomUUID(),
      legs: [
        { kind: "arrival", date: "2027-03-20", route: "DEN → SNA", time: "10:25" },
        { kind: "departure", date: "2027-03-26", route: "SNA → DEN", time: "15:40" },
      ],
      includedPersonIds: personIds,
      note: "Everyone together",
      confirmationCode: "ROUNDTRIP",
      totalCents: 184_200,
      currency: "USD",
      confirmationDocument: {
        storagePath: `${event.slug}/${personIds[0]}/${randomUUID()}.pdf`,
        fileName: "round-trip.pdf",
        mimeType: "application/pdf",
      },
    }, { databaseUrl, actorPersonId: personIds[0]! });
    assert.ok(snapshot);
    const legs = snapshot.state.travelPlans ?? [];
    assert.equal(legs.length, 2);
    assert.deepEqual(legs.map((leg) => leg.kind).sort(), ["arrival", "departure"]);
    assert.equal(legs.reduce((sum, leg) => sum + (leg.totalCents ?? 0), 0), 0);
    assert.equal(legs.filter((leg) => leg.confirmationDocumentFileName).length, 1);
    assert.ok(legs.every((leg) => leg.visibility === "basic"));
  } finally {
    if (commonsId) await database.db.delete(commons).where(eq(commons.id, commonsId));
    if (personIds.length) await database.db.delete(people).where(inArray(people.id, personIds));
    await database.close();
  }
});

test("all flights share basics; legacy privacy flags cannot hide them or expose cost or evidence", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL or DATABASE_URL is required");
  const database = createDatabase(databaseUrl);
  const personIds: string[] = [];
  let commonsId: string | undefined;
  try {
    const insertedPeople = await database.db.insert(people).values([
      { displayName: "Travel Planner", authUserId: randomUUID() },
      { displayName: "Travel Companion", authUserId: randomUUID() },
      { displayName: "Other Traveler", authUserId: randomUUID() },
    ]).returning({ id: people.id });
    personIds.push(...insertedPeople.map((person) => person.id));
    const [event] = await database.db.insert(commons).values({
      slug: `travel-${randomUUID().slice(0, 8)}`,
      name: "Travel Plan Test",
      timezone: "America/Denver",
      createdByPersonId: personIds[0]!,
    }).returning({ id: commons.id, slug: commons.slug });
    assert.ok(event);
    commonsId = event.id;
    await database.db.insert(memberships).values([
      { commonsId, personId: personIds[0]!, status: "active", role: "organizer" },
      { commonsId, personId: personIds[1]!, status: "active", role: "member" },
      { commonsId, personId: personIds[2]!, status: "active", role: "member" },
    ]);

    const options = { databaseUrl, actorPersonId: personIds[0]! };
    const first = await upsertCommonsTravelPlan(event.slug, {
      commandId: randomUUID(),
      kind: "arrival",
      date: "2027-06-24",
      route: "DEN → Edinburgh",
      time: "09:30",
      note: "Need a ride from the airport",
      companionPersonId: personIds[1],
      confirmationCode: "PRIVATE-123",
      totalCents: 184_900,
      currency: "USD",
      confirmationDocument: {
        storagePath: `${event.slug}/${personIds[0]}/${randomUUID()}.pdf`,
        fileName: "flight-confirmation.pdf",
        mimeType: "application/pdf",
      },
    }, options);
    assert.ok(first);
    assert.ok(first.state.travelPlans);
    assert.equal(first.state.travelPlans.length, 1);
    assert.equal(first.state.travelPlans[0]?.date, "2027-06-24");
    assert.deepEqual(first.state.travelPlans[0]?.personIds, personIds.slice(0, 2));
    assert.equal(first.state.travelPlans[0]?.visibility, "basic");
    await assert.rejects(updateCommonsTravelPlanSharing(event.slug, {commandId:randomUUID(), travelPlanId:first.state.travelPlans[0]!.id, visibility:"private"}, options), /Flights share/);
    await database.db.update(travelPlans).set({visibility:"private",totalCents:184_900}).where(eq(travelPlans.id,first.state.travelPlans[0]!.id));
    assert.equal(first.state.travelPlans[0]?.totalCents, undefined);
    assert.equal(first.state.travelPlans[0]?.confirmationDocumentFileName, "flight-confirmation.pdf");

    const companionSnapshot = await getCommonsSnapshot(event.slug, {
      databaseUrl,
      actorPersonId: personIds[1]!,
    });
    assert.equal(companionSnapshot?.state.travelPlans?.[0]?.confirmationCode, "PRIVATE-123");
    assert.equal(companionSnapshot?.state.travelPlans?.[0]?.totalCents, undefined);
    assert.equal(companionSnapshot?.state.travelPlans?.[0]?.confirmationDocumentFileName, undefined);

    const privateOutsiderSnapshot = await getCommonsSnapshot(event.slug, {
      databaseUrl,
      actorPersonId: personIds[2]!,
    });
    assert.equal(privateOutsiderSnapshot?.state.travelPlans?.length, 1);

    const planId = first.state.travelPlans[0]!.id;
    await updateCommonsTravelPlanSharing(event.slug, {
      commandId: randomUUID(),
      travelPlanId: planId,
      visibility: "basic",
    }, options);
    const basicSnapshot = await getCommonsSnapshot(event.slug, {
      databaseUrl,
      actorPersonId: personIds[2]!,
    });
    assert.equal(basicSnapshot?.state.travelPlans?.[0]?.route, "DEN → Edinburgh");
    assert.equal(basicSnapshot?.state.travelPlans?.[0]?.note, "");
    assert.equal(basicSnapshot?.state.travelPlans?.[0]?.totalCents, undefined);
    assert.equal(basicSnapshot?.state.travelPlans?.[0]?.confirmationCode, undefined);

    await assert.rejects(updateCommonsTravelPlanSharing(event.slug, {
      commandId: randomUUID(),
      travelPlanId: planId,
      visibility: "all",
    }, { databaseUrl, actorPersonId: personIds[2]! }), /Only the person who added/);

    await assert.rejects(updateCommonsTravelPlanSharing(event.slug, {
      commandId: randomUUID(),
      travelPlanId: planId,
      visibility: "all",
    }, options), /Flights share/);
    await database.db.update(travelPlans).set({visibility:"all"}).where(eq(travelPlans.id,planId));
    const allSnapshot = await getCommonsSnapshot(event.slug, {
      databaseUrl,
      actorPersonId: personIds[2]!,
    });
    assert.equal(allSnapshot?.state.travelPlans?.[0]?.note, "");
    assert.equal(allSnapshot?.state.travelPlans?.[0]?.totalCents, undefined);
    assert.equal(allSnapshot?.state.travelPlans?.[0]?.currency, undefined);
    assert.equal(allSnapshot?.state.travelPlans?.[0]?.confirmationCode, undefined);

    const withTravelExpense = await addCommonsExpense(event.slug, {
      commandId: randomUUID(),
      title: "Flights",
      amountCents: 184_900,
      paidByPersonId: personIds[0],
      occurredOn: "2027-06-24",
      category: "Transportation",
      itineraryItemId: null,
      stayId: null,
      travelPlanId: planId,
      splitMethod: "equal",
      balanceMode: "allocated",
      confirmationCode: "PRIVATE-123",
      shares: [
        { personId: personIds[0], amountCents: 92_450 },
        { personId: personIds[1], amountCents: 92_450 },
      ],
    }, options);
    assert.equal(withTravelExpense?.state.expenses[0]?.travelPlanId, planId);
    assert.equal(withTravelExpense?.state.expenses[0]?.receiptStatus, "attached");
    assert.equal(withTravelExpense?.state.expenses[0]?.receiptFileName, "flight-confirmation.pdf");

    const updated = await upsertCommonsTravelPlan(event.slug, {
      commandId: randomUUID(),
      kind: "arrival",
      date: "2027-06-25",
      route: "DEN → Glasgow",
      time: "10:15",
      note: "",
      companionPersonId: null,
      includedPersonIds: [personIds[1]],
      confirmationCode: null,
      totalCents: null,
    }, options);
    assert.ok(updated);
    assert.ok(updated.state.travelPlans);
    assert.equal(updated.state.travelPlans.length, 1);
    assert.equal(updated.state.travelPlans[0]?.date, "2027-06-25");
    assert.equal(updated.state.travelPlans[0]?.route, "DEN → Glasgow");
    assert.deepEqual(updated.state.travelPlans[0]?.personIds, [personIds[1]]);
    const travelerSnapshot = await getCommonsSnapshot(event.slug, {
      databaseUrl,
      actorPersonId: personIds[1]!,
    });
    assert.equal(travelerSnapshot?.state.travelPlans?.[0]?.id, planId);
    assert.equal(travelerSnapshot?.state.travelPlans?.[0]?.route, "DEN → Glasgow");

    await assert.rejects(updateCommonsTravelPlanSharing(event.slug, {
      commandId: randomUUID(),
      travelPlanId: planId,
      visibility: "private",
    }, options), /Flights share/);
    const outsiderSnapshot = await getCommonsSnapshot(event.slug, {
      databaseUrl,
      actorPersonId: personIds[2]!,
    });
    assert.equal(outsiderSnapshot?.state.travelPlans?.length, 1);
    assert.equal(
      outsiderSnapshot?.state.auditEvents.some((audit) => audit.targetId === planId),
      true,
    );

    const firstRental = await upsertCommonsTravelPlan(event.slug, {
      commandId: randomUUID(),
      kind: "car_rental",
      date: "2027-06-25",
      route: "EDI Airport → Waverley Station",
      time: null,
      returnDate: "2027-06-27",
      returnTime: null,
      provider: "National",
      vehicle: "Standard SUV",
      status: "confirmed",
      includedPersonIds: [personIds[1]],
      driverPersonId: personIds[1],
      companionPersonId: null,
      note: "Child seat requested",
      confirmationCode: "CAR-PRIVATE",
      totalCents: 65_000,
    }, options);
    assert.ok(firstRental);
    const firstRentalId = firstRental.state.travelPlans?.find((plan) => plan.kind === "car_rental")?.id;
    assert.ok(firstRentalId);
    await upsertCommonsTravelPlan(event.slug, {
      commandId: randomUUID(),
      kind: "car_rental",
      date: "2027-06-28",
      route: "Glasgow Central → GLA Airport",
      time: "09:00",
      returnDate: "2027-06-28",
      returnTime: "15:00",
      provider: "Enterprise",
      vehicle: "Compact",
      status: "booked",
      includedPersonIds: [],
      driverPersonId: personIds[0],
      companionPersonId: null,
      note: "",
      confirmationCode: null,
      totalCents: 22_500,
    }, options);
    const ownerRentals = (await getCommonsSnapshot(event.slug, options))?.state.travelPlans?.filter((plan) => plan.kind === "car_rental") ?? [];
    assert.equal(ownerRentals.length, 2);
    assert.deepEqual(ownerRentals[0]?.personIds, [personIds[1]]);
    assert.equal(ownerRentals[0]?.driverName, "Travel Companion");
    await updateCommonsTravelPlanSharing(event.slug, {
      commandId: randomUUID(),
      travelPlanId: firstRentalId,
      visibility: "basic",
    }, options);
    const sharedRental = (await getCommonsSnapshot(event.slug, { databaseUrl, actorPersonId: personIds[2]! }))?.state.travelPlans?.find((plan) => plan.id === firstRentalId);
    assert.equal(sharedRental?.provider, "National");
    assert.equal(sharedRental?.time, undefined);
    assert.equal(sharedRental?.totalCents, undefined);
    assert.equal(sharedRental?.confirmationCode, undefined);

    await assert.rejects(deleteCommonsTravelPlan(event.slug, {
      commandId: randomUUID(),
      travelPlanId: planId,
    }, { databaseUrl, actorPersonId: personIds[2]! }), /Only the person who added/);
    const afterDelete = await deleteCommonsTravelPlan(event.slug, {
      commandId: randomUUID(),
      travelPlanId: planId,
    }, options);
    assert.ok(afterDelete);
    assert.equal(afterDelete.state.travelPlans?.some((plan) => plan.id === planId), false);
    assert.equal(afterDelete.state.expenses[0]?.receiptStatus, "attached");
    assert.equal(afterDelete.state.expenses[0]?.receiptFileName, "flight-confirmation.pdf");
    const deletedExpense = await deleteCommonsExpense(event.slug, afterDelete.state.expenses[0]!.id, {
      commandId: randomUUID(),
    }, options);
    assert.equal(deletedExpense?.state.expenses.length, 0);
  } finally {
    if (commonsId) await database.db.delete(commons).where(eq(commons.id, commonsId));
    if (personIds.length) await database.db.delete(people).where(inArray(people.id, personIds));
    await database.close();
  }
});
