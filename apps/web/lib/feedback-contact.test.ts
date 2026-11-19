import assert from "node:assert/strict";
import test from "node:test";
import { feedbackScreenshotEmail } from "./feedback-contact";

test("screenshot help opens a addressed email draft with a safe page and report reference, not an upload", () => {
  const url = new URL(feedbackScreenshotEmail({ message: "Cannot save & retry", pagePath: "/c/qa?view=money&token=private", feedbackId: "qa-saved-report" }));
  assert.equal(url.protocol, "mailto:");
  assert.equal(url.pathname, "support@updates.commons.travel");
  assert.equal(url.searchParams.get("subject"), "Commons bug screenshot");
  assert.match(url.searchParams.get("body") ?? "", /Feedback reference: qa-saved-report/);
  assert.match(url.searchParams.get("body") ?? "", /Cannot save & retry/);
  assert.doesNotMatch(url.searchParams.get("body") ?? "", /token=private/);
});
