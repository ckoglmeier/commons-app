import assert from "node:assert/strict";
import test from "node:test";
import { readFlightItinerary } from "./flight-itinerary";

test("ticket issue dates are not travel dates and oversized itineraries are not truncated", () => {
  const missing = readFlightItinerary("Issued: 2026-09-09\nFlight: UA 100\nDEN → SNA\nDeparture: 08:00 AM\nArrival: 10:00 AM");
  assert.equal(missing[0].date, null);
  assert.equal(missing[0].connections?.[0].departureDate, null);
  assert.equal(readFlightItinerary("Flight: UA 100\nDEN → SNA\n2027-03-20\n11:00 PM – 02:00 AM")[0].date, null, "an unmarked overnight arrival needs its own date");
  assert.deepEqual(readFlightItinerary(Array.from({ length: 9 }, () => "DEN → SNA\nDeparture: 2027-03-20 08:00 AM\nArrival: 2027-03-20 10:00 AM").join("\n")), []);
});
import { parseConfirmationText } from "./confirmation-import";
import { readLocalDate, readLocalTime } from "./flight-itinerary";

test("a connection stays outward and the summary uses its final arrival", () => {
  const draft = parseConfirmationText({ sourceLabel: "connections.pdf", text: `Airline: United
DEN -> ORD
Departure date: 2027-03-20
Departure time: 8:00 AM MDT
Arrival date: 2027-03-20
Arrival time: 11:00 AM CDT
UA 100
ORD -> SNA
Departure date: 2027-03-20
Departure time: 12:00 PM CDT
Arrival date: 2027-03-20
Arrival time: 2:00 PM PDT
UA 200
Confirmation number:
ZX9QPL
Seat fee: $25.00
Trip total: CAD 850.00` });
  assert.equal(draft.travelSegments?.length, 1);
  assert.equal(draft.travelSegments?.[0].kind, "arrival");
  assert.equal(draft.travelSegments?.[0].route, "DEN → ORD → SNA");
  assert.equal(draft.travelSegments?.[0].time, "14:00");
  assert.equal(draft.travelSegments?.[0].connections?.length, 2);
  assert.equal(draft.travelSegments?.[0].connections?.[1].flightNumber, "UA 200");
  assert.equal(draft.travelSegments?.[0].connections?.[0].departureTimezone, "MDT");
  assert.equal(draft.confirmationCode, "ZX9QPL");
  assert.equal(draft.totalCents, 85000);
  assert.equal(draft.currency, "CAD");
});

test("missing arrival never borrows departure and ancillary amounts are not totals", () => {
  const draft = parseConfirmationText({ sourceLabel: "partial.txt", text: `Airline: United
DEN -> SNA
Departure date: 2027-03-20
Departure time: 8:00 AM
Seat: $25.00
Confirmation number` });
  assert.equal(draft.travelSegments?.[0].time, null);
  assert.equal(draft.travelSegments?.[0].date, null);
  assert.equal(draft.totalCents, null);
  assert.equal(draft.confirmationCode, null);
});

test("overnight flights retain both dates without using a return date for the outward arrival", () => {
  const draft = parseConfirmationText({ sourceLabel: "overnight.txt", text: `Airline: United
Outbound flight
DEN -> LHR
Departure date: 2027-03-20
Departure time: 8:00 PM MDT
Arrival date: 2027-03-21
Arrival time: 11:00 AM GMT
Return flight
LHR -> DEN
Departure date: 2027-03-26
Departure time: 2:00 PM GMT
Arrival date: 2027-03-26
Arrival time: 7:00 PM MDT
Grand total: £1,200.00` });
  assert.equal(draft.travelSegments?.[0].date, "2027-03-21");
  assert.equal(draft.travelSegments?.[0].time, "11:00");
  assert.equal(draft.travelSegments?.[1].date, "2027-03-26");
  assert.equal(draft.travelSegments?.[1].time, "14:00");
  assert.equal(draft.currency, "GBP");
});

test("invalid calendar dates and clock times become missing, not exceptions", () => {
  assert.equal(readLocalDate("02/31/2027"), null);
  assert.equal(readLocalDate("2027-02-29"), null);
  assert.equal(readLocalTime("13:00 PM"), null);
  assert.equal(readLocalTime("10:99"), null);
  assert.equal(readLocalTime("12:00 AM"), "00:00");
});

test("conflicting totals are left for review", () => {
  const draft = parseConfirmationText({ sourceLabel: "revision.txt", text: "Flight confirmation\nTrip total: $850.00\nTrip total: $950.00" });
  assert.equal(draft.totalCents, null);
});

test("numbered flight headers stay with the following route", () => {
  const legs = readFlightItinerary(`FLIGHT 1 - UA 1480
Denver, CO (DEN) to Santa Ana, CA (SNA)
Saturday, Mar 20, 2027
8:35 a.m. - 10:25 a.m.
FLIGHT 2 - UA 221
Santa Ana, CA (SNA) to Denver, CO (DEN)
Friday, Mar 26, 2027
3:40 p.m. - 6:55 p.m.`);
  assert.deepEqual(legs.map(leg => leg.connections?.[0].flightNumber), ["UA 1480", "UA 221"]);
  assert.deepEqual(legs.map(leg => leg.time), ["10:25", "15:40"]);
});

test("a later labeled flight number cannot fill an earlier missing number", () => {
  const legs = readFlightItinerary(`DEN -> ORD
Departure: 2027-03-20 8:00 AM
Arrival: 2027-03-20 11:00 AM
Flight: UA 200
ORD -> SNA
Departure: 2027-03-20 12:00 PM
Arrival: 2027-03-20 2:00 PM`);
  assert.deepEqual(legs[0].connections?.map(flight => flight.flightNumber), [null, "UA 200"]);
  assert.equal(legs[0].time, "14:00");
});
