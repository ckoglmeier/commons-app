import assert from "node:assert/strict";
import test from "node:test";
import { tripStage } from "./trip-stage-repository";

test("a trip reads as deciding only when it was created with the stages and nobody has said it's going", () => {
  assert.equal(tripStage({ newExperience: true, goingAt: null }), "deciding");
  assert.equal(tripStage({ newExperience: true, goingAt: new Date("2027-01-01T00:00:00Z") }), "going");
  // Trips created before the two stages have the column false and must keep reading as going.
  assert.equal(tripStage({ newExperience: false, goingAt: null }), "going");
  assert.equal(tripStage({ newExperience: false, goingAt: new Date("2027-01-01T00:00:00Z") }), "going");
});
