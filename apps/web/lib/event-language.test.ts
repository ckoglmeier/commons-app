import assert from "node:assert/strict";
import test from "node:test";
import { wholePlanTitle } from "./event-language";

test("uses event language for a single-day event", () => {
  assert.equal(wholePlanTitle("2026-10-08", "2026-10-08"), "The whole event.");
});

test("uses trip language when dates span multiple days", () => {
  assert.equal(wholePlanTitle("2026-10-08", "2026-10-13"), "The whole trip.");
});

test("keeps broader event language until the length is known", () => {
  assert.equal(wholePlanTitle(null, null), "The whole event.");
  assert.equal(wholePlanTitle("2026-10-08", null), "The whole event.");
});
