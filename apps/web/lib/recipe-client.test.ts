import assert from "node:assert/strict";
import test from "node:test";
import { recipeRequest } from "./recipe-client";
test("a lost recipe response does not claim the server rolled back", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("connection lost after commit"); });
  const result = await recipeRequest("/recipe", "POST", {});
  assert.equal(result.ok, false);
  if (!result.ok) { assert.match(result.error, /couldn’t confirm/); assert.doesNotMatch(result.error, /Nothing was|Nothing.*changed/); }
});
test("an unstructured error response keeps the recipe outcome uncertain", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  const result = await recipeRequest("/recipe", "POST", {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /couldn’t confirm/);
});
