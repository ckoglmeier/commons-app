import test from "node:test";
import assert from "node:assert/strict";
import { provisionalTitle } from "./coordinator-turn-title";

test("provisional titles are short single-line headings, never the whole spoken sentence", () => {
  assert.equal(provisionalTitle("Where should we eat on Saturday? We arrive around five."), "Where should we eat on Saturday");
  assert.equal(provisionalTitle("  Dinner near the lodge\nwith the kids  "), "Dinner near the lodge");
  const long = provisionalTitle("Where should the whole family eat dinner on Saturday night when we get in from Denver around five thirty");
  assert.ok(long.length <= 60, long);
  assert.doesNotMatch(long, /\s$/);
  assert.equal(provisionalTitle("   "), "New conversation");
  assert.equal(provisionalTitle("...", "Fallback"), "Fallback");
  assert.equal(provisionalTitle("A".repeat(200)).length, 60);
});
