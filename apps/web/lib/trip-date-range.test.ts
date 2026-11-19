import assert from "node:assert/strict";
import test from "node:test";
import { formatTripDateRange } from "@commons/contracts";

test("B trip dates read as human dates in the receipt: same month, cross-month, cross-year and single day", () => {
  assert.equal(formatTripDateRange("2027-02-12", "2027-02-15"), "Feb 12–15, 2027");
  assert.equal(formatTripDateRange("2027-02-28", "2027-03-02"), "Feb 28 – Mar 2, 2027");
  assert.equal(formatTripDateRange("2026-12-30", "2027-01-02"), "Dec 30, 2026 – Jan 2, 2027");
  assert.equal(formatTripDateRange("2027-02-12", "2027-02-12"), "Feb 12, 2027");
  assert.equal(formatTripDateRange("unset", "2027-02-12"), "unset – 2027-02-12", "anything that is not a plain date is left as given");
});
