import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { CONNECTION_ERROR_MESSAGE, errorKind, personFacingError } from "./person-facing-error";

const fallback = "Expense not saved. Try again.";

test("words Commons wrote for people pass through", () => {
  assert.equal(personFacingError(new Error("Only organizers can do that."), fallback), "Only organizers can do that.");
  class TripError extends Error {}
  assert.equal(personFacingError(new TripError("This trip has ended."), fallback), "This trip has ended.");
  assert.equal(errorKind(new Error("Only organizers can do that.")), "person");
});

test("a request that never arrived says to check the connection", () => {
  assert.equal(personFacingError(new TypeError("Failed to fetch"), fallback), CONNECTION_ERROR_MESSAGE);
  assert.equal(personFacingError(new TypeError("Load failed"), fallback), CONNECTION_ERROR_MESSAGE);
  assert.equal(personFacingError(new TypeError("NetworkError when attempting to fetch resource."), fallback), CONNECTION_ERROR_MESSAGE);
  assert.equal(errorKind(new TypeError("fetch failed")), "network");
});

test("a parser's, driver's or runtime's own text gives the fallback", () => {
  let parseError: unknown;
  try { JSON.parse("Internal Server Error"); } catch (error) { parseError = error; }
  assert.equal(personFacingError(parseError, fallback), fallback);
  const drizzle = Object.assign(new Error("Failed query: select \"id\" from \"people\"\nparams: 1"), { query: "select", params: [] });
  assert.equal(personFacingError(drizzle, fallback), fallback);
  const zod = z.object({ amount: z.number() }).safeParse({ amount: "x" }).error;
  assert.ok(zod);
  assert.equal(personFacingError(zod, fallback), fallback);
  const node = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { syscall: "connect", errno: -61 });
  assert.equal(personFacingError(node, fallback), fallback);
  assert.equal(personFacingError(Object.assign(new Error("terminating connection"), { severity: "FATAL" }), fallback), fallback);
  const abort = new Error("The operation was aborted."); abort.name = "AbortError";
  assert.equal(personFacingError(abort, fallback), fallback);
  assert.equal(personFacingError(new Error("Something broke\n    at handler (route.ts:1:1)"), fallback), fallback);
  assert.equal(personFacingError(new RangeError("Invalid time value"), fallback), fallback);
  assert.equal(personFacingError(new DOMException("Write permission denied.", "NotAllowedError"), fallback), fallback);
});

test("anything that is not an Error with words gives the fallback", () => {
  assert.equal(personFacingError("Failed to fetch", fallback), fallback);
  assert.equal(personFacingError(undefined, fallback), fallback);
  assert.equal(personFacingError(null, fallback), fallback);
  assert.equal(personFacingError(new Error(""), fallback), fallback);
  assert.equal(personFacingError(new Error("   "), fallback), fallback);
});
