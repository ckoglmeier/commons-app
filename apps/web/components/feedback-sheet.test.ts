import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("account feedback uses one short form with no survey or extra name field", () => {
  const sheet = read("./feedback-sheet.tsx");
  for (const file of ["./account-menu.tsx"]) {
    assert.match(read(file), /<FeedbackSheet/);
    assert.doesNotMatch(read(file), /feedbackQuestions|firstTrip|biggestHelp|Next question/);
  }
  assert.match(sheet, /Report a problem/);
  assert.match(sheet, /Suggest an improvement/);
  assert.equal((sheet.match(/<textarea/g) ?? []).length, 1);
  assert.doesNotMatch(sheet, /autoComplete="name"|Your name.*Optional|Next question/);
  assert.match(sheet, /questionVersion: 2/);
  assert.match(sheet, /feedbackPagePath\(window.location.pathname \+ window.location.search\)/);
  assert.match(sheet, /fingerprint !== fingerprint/);
  assert.match(sheet, /idempotencyKey: submission.current.key/);
  assert.match(sheet, /Your message is still here/);
  assert.doesNotMatch(read("../app/globals.css"), /walkthrough-feedback/);
});
