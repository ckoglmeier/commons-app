import assert from "node:assert/strict";
import test from "node:test";
import { instantToZonedLocal, zonedLocalToInstant } from "@commons/contracts";

test("Local wall-clock time round-trips through an instant in the item's own zone, across daylight saving, and rejects what does not exist", () => {
  assert.equal(zonedLocalToInstant("2027-10-12", "09:00", "America/Denver"), "2027-10-12T15:00:00.000Z", "MDT is UTC-6");
  assert.equal(zonedLocalToInstant("2027-02-13", "09:00", "America/Denver"), "2027-02-13T16:00:00.000Z", "MST is UTC-7");
  assert.deepEqual(instantToZonedLocal("2027-10-12T15:00:00.000Z", "America/Denver"), { date: "2027-10-12", time: "09:00" });
  assert.deepEqual(instantToZonedLocal("2027-10-13T00:00:00.000Z", "America/Denver"), { date: "2027-10-12", time: "18:00" }, "the local date, not the UTC date");
  assert.equal(zonedLocalToInstant("2027-03-14", "02:30", "America/Denver"), null, "a wall-clock time skipped by spring-forward");
  assert.equal(zonedLocalToInstant("2027-02-30", "09:00", "America/Denver"), null);
  assert.equal(zonedLocalToInstant("2027-10-12", "25:00", "America/Denver"), null);
  assert.equal(zonedLocalToInstant("2027-10-12", "09:00", "Not/AZone"), null);
  assert.equal(instantToZonedLocal("not a date", "America/Denver"), null);
});
