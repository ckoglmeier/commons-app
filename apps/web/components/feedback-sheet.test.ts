import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("account feedback is a mailto to the instance contact email and disappears without one", () => {
  const menu = read("./account-menu.tsx"), sheet = read("./feedback-sheet.tsx");
  assert.match(menu, /useFeedbackEmail\(\)/);
  assert.match(menu, /canSignOut && feedbackEmail \?/);
  assert.match(menu, /mailto:\$\{feedbackEmail\}/);
  assert.doesNotMatch(menu, /FeedbackSheet|\/api\/v1\/feedback/);
  assert.doesNotMatch(sheet, /process\.env|fetch\(/);
  assert.doesNotMatch(read("../app/globals.css"), /feedback-sheet|walkthrough-feedback/);
});

test("the root layout reads the contact email on the server and passes it down", () => {
  const layout = read("../app/layout.tsx");
  assert.match(layout, /instanceSettings\(\)\.contactEmail/);
  assert.match(layout, /<FeedbackEmailProvider email=/);
});
