import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, memberships, people } from "./schema";
import { findCommonsConfirmationImport, getCommonsSnapshot, updateCommonsTravelPlanSharing, upsertCommonsFlightBooking, upsertCommonsTravelPlan } from "./pilot-repository";
import type { FlightConnection } from "@commons/contracts";
import { summarizeConnections } from "../../domain/src/flight-itinerary";

test("direct and multiple-connection bookings survive reopen and endpoint removals", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL!;
  assert.ok(databaseUrl);
  const db = createDatabase(databaseUrl), actor = randomUUID(), observer = randomUUID(), eventId = randomUUID();
  const slug = `connections-${eventId}`, options = { databaseUrl, actorPersonId: actor };
  const first: FlightConnection = { origin: "DEN", destination: "JFK", departureDate: "2027-03-20", departureTime: "13:00", arrivalDate: "2027-03-20", arrivalTime: "18:50", departureTimezone: "America/Denver", arrivalTimezone: "America/New_York", flightNumber: "DL 451" };
  const overnight: FlightConnection = { origin: "JFK", destination: "LHR", departureDate: "2027-03-20", departureTime: "21:00", arrivalDate: "2027-03-21", arrivalTime: "09:10", departureTimezone: "America/New_York", arrivalTimezone: "Europe/London", flightNumber: "DL 1" };
  const final: FlightConnection = { ...overnight, origin: "LHR", destination: "NCE", departureDate: "2027-03-21", departureTime: "13:00", arrivalTime: "16:00", departureTimezone: "Europe/London", arrivalTimezone: "Europe/Paris", flightNumber: "BA 100" };
  const home: FlightConnection = { ...first, origin: "NCE", destination: "LHR", departureDate: "2027-03-26", arrivalDate: "2027-03-26", departureTime: "08:00", arrivalTime: "09:10", departureTimezone: "Europe/Paris", arrivalTimezone: "Europe/London", flightNumber: "BA 101" };
  const lastHome: FlightConnection = { ...first, origin: "LHR", destination: "DEN", departureDate: "2027-03-26", arrivalDate: "2027-03-26", departureTime: "14:00", arrivalTime: "19:00", departureTimezone: "Europe/London", arrivalTimezone: "America/Denver", flightNumber: "UA 101" };
  const reviewed = (outward: FlightConnection[], returning: FlightConnection[]) => [summarizeConnections("arrival", outward), summarizeConnections("departure", returning)];
  try {
    await db.db.insert(people).values([actor, observer].map(id => ({ id, displayName: "Connection QA", authUserId: randomUUID() })));
    await db.db.insert(commons).values({ id: eventId, slug, name: "Connections QA", timezone: "America/Denver", createdByPersonId: actor });
    await db.db.insert(memberships).values([actor, observer].map(personId => ({ commonsId: eventId, personId, role: "organizer" as const, status: "active" as const })));
    const input = { commandId: randomUUID(), legs: reviewed([first], [home]), includedPersonIds: [actor], note: "", confirmationCode: "PRIVATE-QA", confirmationDocument: { storagePath: `${slug}/${actor}/${"b".repeat(64)}.pdf`, fileName: "connections.pdf", mimeType: "application/pdf" } };
    await upsertCommonsFlightBooking(slug, input, options);
    const save = async (outward: FlightConnection[], returning: FlightConnection[]) => {
      const before = (await getCommonsSnapshot(slug, options))!.state.travelPlans!;
      await upsertCommonsFlightBooking(slug, { ...input, commandId: randomUUID(), confirmationDocument: undefined, legs: reviewed(outward, returning), expectedPlanVersions: before.map(plan => ({ id: plan.id, version: plan.version! })) }, options);
      return (await getCommonsSnapshot(slug, options))!.state.travelPlans!;
    };
    const connected = await save([first, overnight, final], [home, lastHome]);
    const arrival = connected.find(plan => plan.kind === "arrival")!, departure = connected.find(plan => plan.kind === "departure")!;
    assert.equal(arrival.date, "2027-03-21"); assert.equal(arrival.time, "16:00");
    assert.equal(departure.date, "2027-03-26"); assert.equal(departure.time, "08:00");
    assert.deepEqual(arrival.connections, [first, overnight, final]);
    assert.deepEqual(departure.connections, [home, lastHome]);
    assert.equal(arrival.confirmationDocumentFileName, "connections.pdf");
    const shared = (await getCommonsSnapshot(slug, { databaseUrl, actorPersonId: observer }))!.state.travelPlans!;
    assert.deepEqual(shared.find(plan => plan.kind === "arrival")!.connections, arrival.connections);
    assert.ok(shared.every(plan => !plan.confirmationCode && !plan.confirmationDocumentUrl));
    const shortened = await save([first, overnight], [lastHome]);
    assert.equal(shortened.find(plan => plan.kind === "arrival")!.time, "09:10");
    assert.equal(shortened.find(plan => plan.kind === "arrival")!.date, "2027-03-21");
    assert.equal(shortened.find(plan => plan.kind === "departure")!.time, "14:00");
    const direct = await save([first], [lastHome]);
    assert.equal(direct.find(plan => plan.kind === "arrival")!.date, "2027-03-20");
    assert.equal(direct.find(plan => plan.kind === "arrival")!.time, "18:50");
    assert.equal(direct.find(plan => plan.kind === "arrival")!.connections!.length, 1);
  } finally {
    await db.db.delete(commons).where(eq(commons.id, eventId));
    await db.db.delete(people).where(inArray(people.id, [actor, observer]));
    await db.close();
  }
});

test("booking review preserves shared connections and private evidence, rejects stale edits, and keeps source matching private", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL!;
  assert.ok(databaseUrl);
  const db = createDatabase(databaseUrl);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const eventId = randomUUID();
  const slug = `travel-review-${eventId}`;
  const options = { databaseUrl, actorPersonId: ids[0] };
  const flight: FlightConnection = { origin: "DEN", destination: "LHR", departureDate: "2027-03-20", departureTime: "20:00", arrivalDate: "2027-03-21", arrivalTime: "11:00", departureTimezone: "MDT", arrivalTimezone: "GMT", flightNumber: "UA 100" };
  const path = `${slug}/${ids[0]}/${"a".repeat(64)}.png`;
  try {
    await db.db.insert(people).values(ids.map((id, index) => ({ id, displayName: ["Morgan QA", "Alex QA", "Casey QA"][index], authUserId: randomUUID() })));
    await db.db.insert(commons).values({ id: eventId, slug, name: "Booking review fixture", timezone: "America/Denver", createdByPersonId: ids[0] });
    await db.db.insert(memberships).values(ids.map(personId => ({ commonsId: eventId, personId, role: "organizer" as const, status: "active" as const })));
    const input = { commandId: randomUUID(), expectedPlanVersions: [], legs: [{ kind: "arrival", date: "2027-03-21", time: "11:00", route: "DEN → LHR", connections: [flight] }, { kind: "departure", date: "2027-03-26", time: "14:00", route: "LHR → DEN" }], includedPersonIds: ids.slice(0, 2), note: "Meet at arrivals", confirmationCode: "PRIVATE1", totalCents: 85000, currency: "GBP", confirmationDocument: { storagePath: path, fileName: "fixture.png", mimeType: "image/png" } };
    const saved = await upsertCommonsFlightBooking(slug, input, options);
    const plans = saved!.state.travelPlans!;
    assert.equal(plans.length, 2);
    assert.deepEqual(plans.find(plan => plan.kind === "arrival")!.connections, [flight]);
    assert.equal(plans.reduce((sum, plan) => sum + (plan.totalCents ?? 0), 0), 0);
    assert.ok(plans.every(plan=>plan.totalCents===undefined));
    assert.equal((await upsertCommonsFlightBooking(slug, input, options))!.state.travelPlans!.length, 2, "retry is idempotent");
    await assert.rejects(upsertCommonsFlightBooking(slug, { ...input, commandId: randomUUID() }, options), /changed/);
    const versions = plans.map(plan => ({ id: plan.id, version: plan.version! }));
    await upsertCommonsFlightBooking(slug, { ...input, commandId: randomUUID(), expectedPlanVersions: versions, confirmationDocument: undefined, note: "Edited once" }, options);
    await assert.rejects(upsertCommonsFlightBooking(slug, { ...input, commandId: randomUUID(), expectedPlanVersions: versions, confirmationDocument: undefined }, options), /changed/);
    const other = { databaseUrl, actorPersonId: ids[2] };
    const basic = (await getCommonsSnapshot(slug, other))!.state.travelPlans!;
    assert.equal(basic.length, 2);
    assert.ok(basic.every(plan => !plan.totalCents && !plan.confirmationCode && !plan.confirmationDocumentUrl));
    await assert.rejects(findCommonsConfirmationImport(slug, path, other), /does not belong/);
    assert.ok(await findCommonsConfirmationImport(slug, path, options));
    const arrival = plans.find(plan => plan.kind === "arrival")!;
    await assert.rejects(updateCommonsTravelPlanSharing(slug, { commandId: randomUUID(), travelPlanId: arrival.id, visibility: "basic", expectedVersion: arrival.version }, options), /changed/);
    await updateCommonsTravelPlanSharing(slug, { commandId: randomUUID(), travelPlanId: arrival.id, visibility: "basic" }, options);
    const shared = (await getCommonsSnapshot(slug, other))!.state.travelPlans![0];
    assert.equal(shared.confirmationCode, undefined);
    assert.equal(shared.totalCents, undefined);
    assert.deepEqual(shared.connections, [flight]);
    assert.equal(shared.confirmationDocumentUrl, undefined);
    const companion = (await getCommonsSnapshot(slug, { databaseUrl, actorPersonId: ids[1] }))!.state.travelPlans!.find(plan => plan.id === arrival.id)!;
    assert.deepEqual(companion.connections, [flight]);
    assert.equal(companion.confirmationDocumentUrl, undefined, "original stays uploader-only");
    await assert.rejects(upsertCommonsFlightBooking(slug, { ...input, commandId: randomUUID(), expectedPlanVersions: undefined, legs: [{ ...input.legs[0], time: "20:00" }] }, options), /coordination summary/);
    const rental = await upsertCommonsTravelPlan(slug, { commandId: randomUUID(), kind: "car_rental", date: "2027-03-20", route: "SNA Airport", time: null, note: "", includedPersonIds: [ids[0]], companionPersonId: null, driverPersonId: ids[0], provider: "", vehicle: "", returnDate: "2027-03-27", returnTime: null, currency: "EUR", totalCents: 20000 }, options);
    const car = rental!.state.travelPlans!.find(plan => plan.kind === "car_rental")!;
    assert.equal(car.provider, undefined);
    assert.equal(car.vehicle, undefined);
    assert.equal(car.time, undefined);
    assert.equal(car.returnTime, undefined);
    assert.equal(car.currency, "EUR");
    assert.equal(rental!.state.expenses.length, 0);
  } finally {
    await db.db.delete(commons).where(eq(commons.id, eventId));
    await db.db.delete(people).where(inArray(people.id, ids));
    await db.close();
  }
});
