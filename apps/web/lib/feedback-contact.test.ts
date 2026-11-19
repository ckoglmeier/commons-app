import assert from "node:assert/strict";
import test from "node:test";
import { feedbackMailto } from "./feedback-contact";

test("feedback opens an addressed email draft with a safe page path, not an upload", () => {
  const url = new URL(feedbackMailto("hello@example.invalid", { pagePath: "/c/qa?view=money&token=private" }));
  assert.equal(url.protocol, "mailto:");
  assert.equal(url.pathname, "hello@example.invalid");
  assert.equal(url.searchParams.get("subject"), "Commons feedback");
  assert.match(url.searchParams.get("body") ?? "", /Page: /);
  assert.doesNotMatch(url.searchParams.get("body") ?? "", /token=private/);
});
