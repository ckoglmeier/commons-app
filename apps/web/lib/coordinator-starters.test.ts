import test from "node:test";
import assert from "node:assert/strict";
import { coordinatorStarters, coordinatorStarter, coordinatorStarterVersion, starterMessage } from "./coordinator-starters";

test("starter registry has stable unique IDs and no invented trip facts", () => {
  assert.equal(coordinatorStarterVersion, 2);
  assert.deepEqual(coordinatorStarters.map(item => item.id), ["dates", "attendance", "stay", "question"]);
  assert.deepEqual(coordinatorStarters.map(item => item.workflowKey), ["trip_feasibility", "attendance_confirmation", "lodging_selection", "general_poll"]);
  assert.equal(coordinatorStarter("dates").opening({}), "Which dates or destinations are you considering?");
  assert.match(coordinatorStarter("dates").opening({ startsOn: "2027-03-20", endsOn: "2027-03-29" }), /2027-03-20 and ends on 2027-03-29/);
  assert.equal(starterMessage(null, "Hi"), "Hi");
  assert.equal(starterMessage("question", "Hi"), "Hi");
  assert.match(starterMessage("stay", "Lodge or Inn 🏡"), /where to stay\.\n\nLodge or Inn 🏡/);
});
