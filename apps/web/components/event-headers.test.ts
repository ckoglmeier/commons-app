import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("event destinations use plain headers without duplicate entry prompts", async () => {
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  const home = await readFile(new URL("./home-dashboard.tsx", import.meta.url), "utf8");
  assert.match(home, /className="event-page-header trip-page-heading"><h2>Trip<\/h2>/);
  for (const title of ["Activities", "Money", "Photos"]) assert.ok(app.includes(`<h2>${title}</h2>`));
  assert.doesNotMatch(app, /planScopeTitle|costScopeTitle|Commons photo mapping/);
  const plan = app.slice(app.indexOf("function PlanView"), app.indexOf("function MoneyView"));
  assert.doesNotMatch(plan, /onClick=\{openTripDetails\}/);
  const editor = app.slice(app.indexOf("function TripDetailsEditor"), app.indexOf("function ConfirmationUploadControl"));
  assert.doesNotMatch(editor, /type="checkbox"/);
  assert.match(app, /function MoneySettingsSheet/);
  assert.match(app, /Turning this on hides those balances/);
});

test("shared headers and section dividers retain mobile-safe layout", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /event-page-header.*flex-wrap: wrap/);
  assert.match(css, /event-page-header button.*var\(--cm-touch-target\)/);
  assert.match(css, /money-actual-heading \{ border-top: 1px solid var\(--cm-color-line\)/);
});
