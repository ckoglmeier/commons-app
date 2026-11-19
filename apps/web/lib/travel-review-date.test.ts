import assert from "node:assert/strict";
import test from "node:test";
import { formatTravelReviewDate } from "./travel-review-date";

test("an unreadable or partial confirmation leaves the Travel review usable", () => {
  for (const value of ["", "invalid", "2027-02-31", "2027-13-01"]) {
    assert.equal(formatTravelReviewDate(value), "Date needed");
  }
  assert.equal(formatTravelReviewDate("2027-03-20"), "Saturday, March 20");
});
