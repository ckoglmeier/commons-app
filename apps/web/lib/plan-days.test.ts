import assert from "node:assert/strict";
import test from "node:test";
import { planDays, selectedPlanDay, tripDays } from "./plan-days";

test("keeps an undated event out of the dated plan calendar", () => {
  const days = tripDays(null, null);

  assert.deepEqual(days, []);
  assert.equal(selectedPlanDay(days, ""), null);
});

test("rejects a stale selected day after event dates change", () => {
  const days = tripDays("2026-10-08", "2026-10-10");

  assert.equal(selectedPlanDay(days, "2026-10-07"), null);
  assert.equal(selectedPlanDay(days, "2026-10-09")?.day, "Fri");
});

test("builds a bounded inclusive event calendar", () => {
  const days = tripDays("2026-10-08", "2026-10-10");

  assert.deepEqual(days.map((day) => day.id), ["2026-10-08", "2026-10-09", "2026-10-10"]);
});

test("scheduled activities remain reachable when the event has no dates or a different range", () => {
  assert.deepEqual(planDays(null, null, ["2027-03-22", "2027-03-20", "2027-03-22"]).map(day => day.id), ["2027-03-20", "2027-03-22"]);
  assert.deepEqual(planDays("2027-03-20", "2027-03-21", ["2027-03-23"]).map(day => day.id), ["2027-03-20", "2027-03-21", "2027-03-23"]);
  assert.deepEqual(planDays(null, null, ["invalid", "2027-02-30"]), []);
});

test("shortening a trip moves saved later dates out of the regular calendar", () => {
  const days = planDays("2027-04-10", "2027-04-12", ["2027-04-14"]);
  assert.deepEqual(days.filter(day => !day.outsideTrip).map(day => day.id), ["2027-04-10", "2027-04-11", "2027-04-12"]);
  assert.equal(selectedPlanDay(days, "2027-04-14")?.outsideTrip, true);
  assert.equal(planDays(null, null, ["2027-04-14"])[0].outsideTrip, false);
});
