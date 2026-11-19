import assert from "node:assert/strict";
import test from "node:test";
import { hasTripStarted, isPostTrip } from "./trip-phase";

const trip = {
  status: "planning" as const,
  startsOn: "2026-10-08",
  endsOn: "2026-10-13",
  timezone: "America/Denver",
};

test("keeps settlement hidden through the final trip day", () => {
  assert.equal(isPostTrip(trip, new Date("2026-10-14T05:59:59Z")), false);
});

test("opens settlement on the day after the trip in its timezone", () => {
  assert.equal(isPostTrip(trip, new Date("2026-10-14T06:00:00Z")), true);
});

test("honors an explicit closing or archived state", () => {
  assert.equal(isPostTrip({ ...trip, status: "closing" }, new Date("2026-09-01T12:00:00Z")), true);
  assert.equal(isPostTrip({ ...trip, status: "archived" }, new Date("2026-09-01T12:00:00Z")), true);
});

test("does not infer a post-trip phase without an end date", () => {
  assert.equal(isPostTrip({ ...trip, endsOn: null }, new Date("2027-01-01T12:00:00Z")), false);
});

test("keeps the plan primary until the trip starts in its timezone", () => {
  assert.equal(hasTripStarted(trip, new Date("2026-10-08T05:59:59Z")), false);
  assert.equal(hasTripStarted(trip, new Date("2026-10-08T06:00:00Z")), true);
});

test("does not minimize an undated plan", () => {
  assert.equal(hasTripStarted({ ...trip, startsOn: null }, new Date("2027-01-01T12:00:00Z")), false);
});
