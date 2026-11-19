import assert from "node:assert/strict";
import test from "node:test";
import { normalizePollPublicId, publicPollPath } from "./poll-route";

test("builds and normalizes short public poll routes", () => {
  assert.equal(normalizePollPublicId("ABCDEF123456"), "abcdef123456");
  assert.equal(publicPollPath("abcdef123456"), "/c/poll/abcdef123456");
});

test("rejects invalid public poll IDs", () => {
  assert.equal(normalizePollPublicId("not-a-poll"), null);
  assert.throws(() => publicPollPath("not-a-poll"));
});
