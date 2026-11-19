import test from "node:test";
import assert from "node:assert/strict";
import { participantRecipeSummary } from "./recipe-outcome";

test("participant recipe recaps allow shared facts, not private legacy exception text", () => {
  const privateNote = "PRIVATE: Sam needs a ground floor", trip = { startsOn: "2027-04-15", endsOn: "2027-04-17", locationNames: ["Sonoma"] };
  const dates = { kind: "dates_location", alternativeId: crypto.randomUUID(), startsOn: trip.startsOn, endsOn: trip.endsOn, place: "Sonoma", exceptions: [privateNote], basis: { respondedCount: 2, askedCount: 3, awaitingCount: 1, acceptedCount: 2, preferredCount: 1 } };
  const attendance = { kind: "attendance", counts: { in: 2, maybe: 0, out: 0, unanswered: 1 }, headcount: { in: 2, maybe: 0 }, people: [], exceptions: [privateNote], excludedResponses: 0, basedOn: trip };
  const lodging = { kind: "lodging", optionId: crypto.randomUUID(), name: "House A", url: "https://example.com", rooms: "Two rooms", beds: "unknown", pricing: "Unknown", acceptedCount: 2, preferredCount: 1, respondedCount: 2, awaitingCount: 1, conflictsAcknowledged: [privateNote], exceptions: [privateNote], basedOn: { trip, attendanceOutcomeId: null, headcountIn: null, headcountMaybe: null } };
  for (const outcome of [dates, attendance, lodging]) assert.doesNotMatch(participantRecipeSummary(outcome), /PRIVATE|ground floor|Sam/);
  assert.match(participantRecipeSummary(dates), /Sonoma/);
  assert.match(participantRecipeSummary(attendance), /2 in.*1 not answered/);
  assert.match(participantRecipeSummary(lodging), /House A.*preference, not a booking/);
  assert.equal(participantRecipeSummary({ ...lodging, participantSummary: "Our reviewed public preference: House A." }), "Our reviewed public preference: House A.");
  assert.equal(participantRecipeSummary({ ...dates, alternativeId: "invalid-id", summary: privateNote }), "An organizer recorded a decision for this poll.", "invalid legacy payloads fail closed without weakening the schema");
});
