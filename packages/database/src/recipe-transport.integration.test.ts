import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { eventAttendanceDates } from "@commons/contracts";
import { createDatabase } from "./client";
import { CommandAccessError } from "./event-command";
import { setEventAttendance } from "./attendance-repository";
import { upsertCommonsFlightBooking } from "./pilot-repository";
import { getTransportReview } from "./recipe-transport-repository";
import { commons, memberships, people, travelPlans } from "./schema";

const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";

test("transport review groups shared flights deterministically and exposes only shared basics", { skip }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname), "Disposable local database only");
  const database = createDatabase(url), db = database.db;
  const event = randomUUID(), [org, ana, ben, cy, dee, eve, gus] = Array.from({ length: 7 }, () => randomUUID());
  const as = (actorPersonId: string) => ({ databaseUrl: url, actorPersonId });
  await db.insert(people).values([[org, "Olive Organizer"], [ana, "Ana"], [ben, "Ben"], [cy, "Cy"], [dee, "Dee"], [eve, "Eve"], [gus, "Gus"]].map(([id, displayName]) => ({ id, displayName, authUserId: id })));
  await db.insert(commons).values({ id: event, slug: event, name: "Wine country weekend", createdByPersonId: org, timezone: "America/Los_Angeles", startsOn: "2027-04-15", endsOn: "2027-04-17" });
  await db.insert(memberships).values([{ commonsId: event, personId: org, role: "organizer", status: "active" }, ...[ana, ben, cy, dee, eve, gus].map(personId => ({ commonsId: event, personId, role: "member" as const, status: "active" as const }))]);
  const fly = (who: string, arrival: { route: string; date: string; time: string; connections?: unknown[] }, departure?: { route: string; date: string; time: string }, extra: object = {}) => upsertCommonsFlightBooking(event, {
    commandId: randomUUID(), legs: [{ kind: "arrival", ...arrival }, ...(departure ? [{ kind: "departure", ...departure }] : [])], includedPersonIds: [who], note: "", ...extra }, as(who));
  try {
    await fly(ana, { route: "DEN → SFO", date: "2027-04-15", time: "15:10", connections: [{ origin: "DEN", destination: "SFO", departureDate: "2027-04-15", departureTime: "12:00", arrivalDate: "2027-04-15", arrivalTime: "15:10",
      departureTimezone: "America/Denver", arrivalTimezone: "America/Los_Angeles", flightNumber: "UA1" }] }, { route: "SFO → DEN", date: "2027-04-17", time: "11:00" }, { note: "PRIVATE-NOTE", confirmationCode: "CONF123", totalCents: 99_900, currency: "USD" });
    await fly(ben, { route: "DEN → SFO", date: "2027-04-15", time: "15:40" }, { route: "SFO → DEN", date: "2027-04-17", time: "11:30" });
    await fly(cy, { route: "DEN → OAK", date: "2027-04-15", time: "15:20" });
    await fly(dee, { route: "ORD → sfo", date: "2027-04-15", time: "23:50" });
    await fly(eve, { route: "ORD → SFO", date: "2027-04-16", time: "00:20" });
    const attendance = (who: string) => setEventAttendance(event, { commandId: randomUUID(), state: "attending", reviewedDates: eventAttendanceDates("2027-04-15", "2027-04-17") }, as(who));
    await attendance(ana);

    await assert.rejects(getTransportReview(event, as(ana)), CommandAccessError, "only organizers coordinate rides");
    const plansBefore = (await db.select().from(travelPlans).where(eq(travelPlans.commonsId, event))).length;
    const review = await getTransportReview(event, as(org));
    const proposal = review.proposal;
    assert.equal(review.flights, 7); assert.equal(review.travelers, 7);
    const arrivals = proposal.groups.filter(group => group.direction === "arrival");
    assert.equal(arrivals.length, 2, "SFO daytime and SFO around midnight; Cy at a different airport is not merged");
    const day = arrivals.find(group => group.startLocal === "15:10")!;
    assert.deepEqual(day.members.map(member => [member.name, member.provisional]), [["Ana", false], ["Ben", true]], "an unconfirmed traveler is counted apart from a confirmed one");
    assert.deepEqual([day.confirmedCount, day.provisionalCount], [1, 1]);
    assert.equal(day.assumedTimezone, true, "Ben's flight gave no time zone, so the trip zone was assumed and said so");
    const night = arrivals.find(group => group.startLocal === "23:50")!;
    assert.deepEqual(night.members.map(member => member.name), ["Dee", "Eve"], "a landing after midnight still joins the late group, and case differences in the airport don't split it");
    assert.deepEqual(night.dates, ["2027-04-15", "2027-04-16"]);
    assert.deepEqual(proposal.places.find(item => item.place === "OAK")?.names, ["Cy"], "a different airport stays visible instead of being dropped");
    assert.deepEqual(proposal.groups.filter(group => group.direction === "departure").map(group => group.members.map(member => member.name)), [["Ana", "Ben"]], "return legs group separately");
    assert.deepEqual(proposal.noFlight.filter(item => item.name === "Gus").map(item => item.direction).sort(), ["arrival", "departure"]);
    assert.ok(proposal.assumptions.some(item => /isn’t a pickup time/.test(item)));
    assert.ok(!JSON.stringify(review).match(/PRIVATE-NOTE|CONF123|99900|99,900/), "costs, notes and confirmation codes are never read");
    assert.equal((await db.select().from(travelPlans).where(eq(travelPlans.commonsId, event))).length, plansBefore, "reading suggestions saved nothing");
    assert.equal((await getTransportReview(event, { ...as(org), windowMinutes: 15 })).proposal.groups.filter(group => group.direction === "arrival").length, 0, "a narrower window leaves everyone 30 minutes apart on their own");
  } finally {
    await db.delete(commons).where(eq(commons.id, event));
    await db.delete(people).where(inArray(people.id, [org, ana, ben, cy, dee, eve, gus]));
    await database.close();
  }
});
