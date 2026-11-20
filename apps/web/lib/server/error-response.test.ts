import assert from "node:assert/strict";
import test from "node:test";
import { registerComponentImportStubs } from "../test-support/hook-harness";
registerComponentImportStubs();

test("a response carries Commons's own words, never a driver's query", async (t) => {
  const { errorTextForResponse } = await import("./error-response");
  const logged = t.mock.method(console, "error", () => {});
  assert.equal(errorTextForResponse(new Error("Only organizers can do that."), "Profile not saved."), "Only organizers can do that.");
  assert.equal(logged.mock.callCount(), 0);
  const drizzle = Object.assign(new Error("Failed query: select \"id\" from \"people\" where \"people\".\"auth_user_id\" = $1\nparams: 9b404bd8,1"), { query: "select", params: [] });
  const text = errorTextForResponse(drizzle, "Profile not saved.");
  assert.equal(text, "Profile not saved.");
  assert.doesNotMatch(text, /select/);
  assert.equal(logged.mock.callCount(), 1, "the withheld error goes to the server log");
  assert.equal(errorTextForResponse(new TypeError("fetch failed"), "Profile not saved."), "Profile not saved.");
});
