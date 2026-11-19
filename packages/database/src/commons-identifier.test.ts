import assert from "node:assert/strict";
import test from "node:test";
import { isCommonsId } from "./commons-identifier";

test("distinguishes event UUIDs from legacy name slugs", () => {
  assert.equal(isCommonsId("8b26fd00-0000-4000-8000-000000000001"), true);
  assert.equal(isCommonsId("a-girls-weekend-in-napa-sonoma-with-10-women-in--8b26fd"), false);
  assert.equal(isCommonsId("not-a-uuid"), false);
});
