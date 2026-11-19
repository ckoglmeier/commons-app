import assert from "node:assert/strict";
import test from "node:test";
import { parseConfirmationText } from "./confirmation-import";

test("extracts a lodging confirmation into an editable draft", () => {
  const draft = parseConfirmationText({ sourceLabel: "hotel.pdf", text: `
Hotel: Laguna House
Address: 1037 Glenneyre Street, Laguna Beach
Check-in: March 20, 2027 at 4:00 PM
Check-out: March 26, 2027 at 11:00 AM
Confirmation number: AB12CD
Total paid: $3,842.19
Taxes and fees included
` });
  assert.equal(draft.kind, "stay");
  assert.equal(draft.startsOn, "2027-03-20");
  assert.equal(draft.endsOn, "2027-03-26");
  assert.equal(draft.totalCents, 384219);
  assert.equal(draft.confirmationCode, "AB12CD");
});

test("extracts a flight confirmation", () => {
  const draft = parseConfirmationText({ sourceLabel: "flight.pdf", text: `
Airline: United Airlines
Flight number: UA 1842
Departure date: 03/20/2027
Departure time: 8:35 AM
DEN -> SNA
Confirmation code: ZX9QPL
Trip total: USD $1,204.44
` });
  assert.equal(draft.kind, "flight");
  assert.equal(draft.route, "DEN → SNA");
  assert.equal(draft.startsOn, "2027-03-20");
  assert.equal(draft.startTime, "08:35");
  assert.equal(draft.totalCents, 120444);
});

test("extracts a car rental confirmation", () => {
  const draft = parseConfirmationText({ sourceLabel: "car.pdf", text: `
Rental company: National
Pick-up location: SNA Airport
Pick-up date: 03/20/2027
Pick-up time: 1:15 PM
Drop-off location: SNA Airport
Return: 03/26/2027 at 9:30 AM
Reservation number: CAR1234
Rental total: $612.00
Vehicle: Standard SUV
` });
  assert.equal(draft.kind, "car_rental");
  assert.equal(draft.route, "SNA Airport → SNA Airport");
  assert.equal(draft.startsOn, "2027-03-20");
  assert.equal(draft.startTime, "13:15");
  assert.equal(draft.totalCents, 61200);
});

test("extracts outbound and return flights with the coordination time for each direction", () => {
  const draft = parseConfirmationText({ sourceLabel: "round-trip.pdf", text: `
United Airlines
Record locator: ZX9QPL
Outbound flight
Departure date: 03/20/2027
Depart: 8:35 a.m.
Arrival date: 03/20/2027
Arrive: 10:25 a.m.
DEN -> SNA
Return flight
Departure date: 03/26/2027
Depart: 3:40 p.m.
Arrival date: 03/26/2027
Arrive: 6:55 p.m.
SNA -> DEN
Trip total: $850.00
` });
  assert.equal(draft.confirmationCode, "ZX9QPL");
  assert.deepEqual(draft.travelSegments?.map(({ connections, ...summary }) => { assert.equal(connections?.length, 1); return summary; }), [
    { kind: "arrival", date: "2027-03-20", route: "DEN → SNA", time: "10:25", departureTime: "08:35", arrivalTime: "10:25" },
    { kind: "departure", date: "2027-03-26", route: "SNA → DEN", time: "15:40", departureTime: "15:40", arrivalTime: "18:55" },
  ]);
  assert.equal(draft.totalCents, 85_000);
});

test("extracts a round trip from an airline itinerary without outbound headings", () => {
  const draft = parseConfirmationText({ sourceLabel: "united-itinerary.pdf", text: `
United Airlines
Confirmation number ZX9QPL

Denver, CO (DEN) to Santa Ana, CA (SNA)
Saturday, Mar 20, 2027
8:35 a.m. – 10:25 a.m.
UA 1480

Santa Ana, CA (SNA) to Denver, CO (DEN)
Friday, Mar 26, 2027
3:40 p.m. – 6:55 p.m.
UA 221

Trip total $850.00
` });

  assert.equal(draft.confirmationCode, "ZX9QPL");
  assert.deepEqual(draft.travelSegments?.map(({ connections, ...summary }) => { assert.equal(connections?.length, 1); return summary; }), [
    { kind: "arrival", date: "2027-03-20", route: "DEN → SNA", time: "10:25", departureTime: "08:35", arrivalTime: "10:25" },
    { kind: "departure", date: "2027-03-26", route: "SNA → DEN", time: "15:40", departureTime: "15:40", arrivalTime: "18:55" },
  ]);
  assert.equal(draft.startsOn, "2027-03-20");
  assert.equal(draft.endsOn, "2027-03-26");
  assert.equal(draft.totalCents, 85_000);
  assert.deepEqual(draft.warnings, []);
});
