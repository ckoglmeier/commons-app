import assert from "node:assert/strict";
import test from "node:test";
import { AddItineraryItemCommandSchema, UpdateItineraryItemCommandSchema } from "@commons/contracts";
import { itineraryDurationMinutes, itineraryEndTime, formatDuration } from "@commons/contracts";

test("duration is optional, clearable, and bounded in add and edit commands", () => {
  const base = { commandId: "duration-test", title: "Yoga", date: null, time: null, participantScope: "everyone", occurredAt: "2026-09-07T12:00:00Z" };
  for (const schema of [AddItineraryItemCommandSchema, UpdateItineraryItemCommandSchema]) {
    assert.equal(schema.parse(base).durationMinutes, undefined);
    assert.equal(schema.parse({ ...base, durationMinutes: null }).durationMinutes, null);
    for (const value of [1, 60, 90, 10080]) assert.equal(schema.parse({ ...base, durationMinutes: value }).durationMinutes, value);
    for (const value of [0, -1, 1.5, 10081, "90"]) assert.equal(schema.safeParse({ ...base, durationMinutes: value }).success, false);
  }
});

test("duration is independent of dates and uses elapsed time across midnight and DST", () => {
  assert.equal(itineraryDurationMinutes({ durationMinutes: 90 }), 90);
  assert.equal(itineraryDurationMinutes({ startsAt: "2027-03-14T06:30:00Z", endsAt: "2027-03-14T08:00:00Z" }), 90);
  assert.equal(itineraryEndTime("2027-03-14T06:30:00Z", 90), "2027-03-14T08:00:00.000Z");
  assert.equal(itineraryEndTime("2027-07-01T23:30:00Z", 90), "2027-07-02T01:00:00.000Z");
  assert.equal(itineraryEndTime(null, 90), undefined);
  assert.equal(itineraryEndTime("2027-07-01T23:30:00Z", null), undefined);
  assert.equal(itineraryDurationMinutes({}), null);
  assert.equal(formatDuration(60), "1 hr"); assert.equal(formatDuration(90), "1 hr 30 min"); assert.equal(formatDuration(45), "45 min");
});
