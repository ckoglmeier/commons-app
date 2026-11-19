import assert from "node:assert/strict";
import test from "node:test";
import { pollResultsAreVisible } from "./poll-repository";

test("transparent poll results remain visible while voting is open", () => {
  assert.equal(pollResultsAreVisible("transparent", "open"), true);
});

test("secret poll results stay hidden until voting closes", () => {
  assert.equal(pollResultsAreVisible("secret", "open"), false);
  assert.equal(pollResultsAreVisible("secret", "closed"), true);
});
