import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { UpsertFlightBookingCommandSchema, type FlightConnection } from "@commons/contracts";
import { parseConfirmationText } from "@commons/domain";
import { summarizeConnections } from "../../../packages/domain/src/flight-itinerary";
import { readUploadedFile } from "./import/read-uploaded-file";
import { appendFlightConnection, blankFlightConnection, maxFlightsPerDirection, removeFlightConnection, summarizeFlightReview, type FlightLegReview } from "./flight-booking-review";

const flight = (origin: string, destination: string, overrides: Partial<FlightConnection> = {}): FlightConnection => ({ ...blankFlightConnection(), origin, destination, departureDate: "2027-03-20", departureTime: "20:00", arrivalDate: "2027-03-21", arrivalTime: "11:00", departureTimezone: "America/Denver", arrivalTimezone: "Europe/London", flightNumber: "UA 100", ...overrides });
const leg = (kind: FlightLegReview["kind"], connections: FlightConnection[]): FlightLegReview => summarizeFlightReview({ kind, date: "", time: "", route: "" }, connections);

test("direct and connected summaries match the import summarizer and save schema", () => {
  const first = flight("DEN", "LHR"), final = flight("LHR", "NCE", { departureDate: "2027-03-21", departureTime: "13:00", arrivalDate: "2027-03-21", arrivalTime: "16:00", arrivalTimezone: "Europe/Paris" });
  for (const connections of [[first], [first, final]]) {
    for (const kind of ["arrival", "departure"] as const) {
      const reviewed = leg(kind, connections), imported = summarizeConnections(kind, connections);
      assert.equal(reviewed.route, imported.route);
      assert.equal(reviewed.date, imported.date);
      assert.equal(reviewed.time, imported.time);
      const saved = UpsertFlightBookingCommandSchema.parse({ commandId: randomUUID(), legs: [reviewed], includedPersonIds: [randomUUID()], note: "" });
      assert.deepEqual(JSON.parse(JSON.stringify(saved)).legs[0].connections, connections);
    }
  }
});

test("adding carries only the prior arrival airport/timezone and clears an unknown final arrival", () => {
  const outward = leg("arrival", [flight("DEN", "LHR")]);
  const next = appendFlightConnection(outward);
  assert.deepEqual(next.connections![1], { ...blankFlightConnection(), origin: "LHR", departureTimezone: "Europe/London" });
  assert.equal(next.date, "");
  assert.equal(next.time, "");
  assert.equal(next.route, "");
  assert.equal(outward.connections!.length, 1, "the prior draft is not mutated");
  const home = leg("departure", [flight("LHR", "DEN")]);
  assert.equal(appendFlightConnection(home).date, home.date);
  assert.equal(appendFlightConnection(home).time, home.time);
});

test("removing final outbound or first homeward flights updates the exact coordination endpoint", () => {
  const first = flight("DEN", "LHR"), second = flight("LHR", "NCE", { departureDate: "2027-03-21", departureTime: "13:00", arrivalTime: "16:00" }), final = flight("NCE", "FCO", { departureDate: "2027-03-22", departureTime: "08:00", arrivalDate: "2027-03-22", arrivalTime: "09:30" });
  const outward = leg("arrival", [first, second, final]);
  const withoutLast = removeFlightConnection(outward, 2);
  assert.equal(withoutLast.date, "2027-03-21");
  assert.equal(withoutLast.time, "16:00");
  assert.deepEqual(removeFlightConnection(outward, 1).connections, [first, final]);
  assert.equal(removeFlightConnection(leg("departure", [first, second, final]), 0).time, "13:00");
  assert.equal(removeFlightConnection(leg("departure", [first, second, final]), 0).date, "2027-03-21");
});

test("eight-flight, one-flight and legacy summary-only boundaries preserve data", () => {
  const maximum = leg("arrival", Array.from({ length: maxFlightsPerDirection }, () => flight("DEN", "LHR")));
  assert.equal(appendFlightConnection(maximum), maximum);
  const direct = leg("arrival", [flight("DEN", "LHR")]);
  assert.equal(removeFlightConnection(direct, 0), direct);
  assert.equal(removeFlightConnection(maximum, -1), maximum);
  assert.equal(removeFlightConnection(maximum, 8), maximum);
  const legacy: FlightLegReview = { kind: "arrival", route: "DEN → LHR", date: "2027-03-21", time: "11:00" };
  assert.equal(appendFlightConnection(legacy), legacy);
});

test("real round-trip PDF extraction can be edited, extended and saved with the existing command", async () => {
  const bytes = await readFile(new URL("./import/fixtures/confirmations/round-trip-flight-confirmation.pdf", import.meta.url));
  const source = await readUploadedFile(new File([new Uint8Array(bytes)], "round-trip.pdf", { type: "application/pdf" }));
  const draft = parseConfirmationText(source);
  const legs = draft.travelSegments!.map(segment => ({ kind: segment.kind, route: segment.route ?? "", date: segment.date ?? "", time: segment.time ?? "", connections: segment.connections }));
  const appended = appendFlightConnection(legs[0]);
  appended.connections![1] = flight("SNA", "SFO", { flightNumber: "UA 222", departureDate: "2027-03-20", arrivalDate: "2027-03-20", arrivalTime: "14:00", departureTimezone: "America/Los_Angeles", arrivalTimezone: "America/Los_Angeles" });
  const edited = summarizeFlightReview(appended, appended.connections!);
  const command = UpsertFlightBookingCommandSchema.parse({ commandId: randomUUID(), legs: [edited, legs[1]], includedPersonIds: [randomUUID()], note: "", confirmationCode: draft.confirmationCode, confirmationDocument: { storagePath: "sample/owner/round-trip.pdf", fileName: "round-trip.pdf", mimeType: "application/pdf" } });
  assert.equal(command.legs[0].time, "14:00");
  assert.equal(command.legs[0].connections!.length, 2);
  assert.equal(command.legs[0].connections![0].flightNumber, "UA 1480");
  assert.equal(command.legs[1].connections![0].flightNumber, "UA 221");
  assert.equal(command.confirmationCode, "ZX9QPL");
  assert.equal(command.confirmationDocument!.fileName, "round-trip.pdf");
});
