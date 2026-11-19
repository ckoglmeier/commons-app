import assert from "node:assert/strict";
import test from "node:test";
import type { TravelPlan } from "@commons/contracts";
import { mergeTravelPlans } from "./merge-travel-plans";

const rental: TravelPlan = { id: "rental-a", personId: "owner", personIds: ["owner", "companion"], personName: "Owner + Companion", kind: "car_rental", date: "2027-03-20", returnDate: "2027-03-27", route: "Airport", note: "", sourceLabel: "QA" };
test("Plan retains multiple rentals with overlapping travelers and different returns", () => {
  const second = { ...rental, id: "rental-b", returnDate: "2027-03-28" };
  assert.deepEqual(mergeTravelPlans([], [rental, second]).map(plan => plan.returnDate), ["2027-03-27", "2027-03-28"]);
  assert.deepEqual(mergeTravelPlans([rental, second], [{ ...rental, route: "Changed airport" }]).map(plan => [plan.id, plan.route]), [["rental-b", "Airport"], ["rental-a", "Changed airport"]]);
});

test("saved flight legs still replace overlapping legacy conversation summaries", () => {
  const old: TravelPlan = { ...rental, id: "legacy-arrival", kind: "arrival", returnDate: undefined };
  const current = { ...old, id: "saved-arrival", route: "DEN → SNA" };
  const home = { ...old, id: "home", kind: "departure" as const };
  assert.deepEqual(mergeTravelPlans([old, home, rental], [current]).map(plan => plan.id), ["home", "rental-a", "saved-arrival"]);
});
