import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("trip settings say trip, not event", async () => {
  const app = await read("./commons-app.tsx");
  for (const phrase of ["Trip details not updated. Try again.", "<strong>Edit trip</strong>", "\"Cancel trip editor\"", "\"Close trip editor\"", "<span>Trip name</span>", "\"Save trip details\""]) assert.ok(app.includes(phrase), phrase);
  assert.doesNotMatch(app, /Edit event|Event name|Save event details|event editor|Event details not updated/);
});

test("visually hidden file inputs stay out of the Tab order; the visible button is the control", async () => {
  for (const [path, count] of [["./commons-app.tsx", 4], ["../app/new/new-commons-form.tsx", 1]] as const) {
    const source = await read(path);
    const hidden = source.match(/<input[^>]*className="sr-only"[^>]*type="file"[^>]*>/g) ?? [];
    assert.equal(hidden.length, count, path);
    for (const input of hidden) assert.match(input, /tabIndex=\{-1\}/, input);
  }
  assert.match(await read("./commons-app.tsx"), /tabIndex=\{-1\} aria-label="Choose trip photos"/);
});

test("receipt wording promises no upload", async () => {
  const app = await read("./commons-app.tsx");
  assert.match(app, /Enter the cost from your receipt\. Commons keeps the details, not the receipt itself\./);
  assert.match(app, /Track spending without shares, reimbursements, or who owes whom\./);
  assert.doesNotMatch(app, /Receipt uploads aren’t available here yet|spending and receipts/);
});

test("the trip page title names the trip only for someone who can open it, from one cached load", async () => {
  const page = await read("../app/c/[slug]/page.tsx");
  assert.match(page, /const loadTrip = cache\(loadCommonsSnapshot\)/);
  assert.match(page, /await loadTrip\(identifier\)\.catch\(\(\) => null\)/);
  assert.match(page, /`\$\{snapshot\.commons\.name\} — Commons` : "Trip — Commons"/);
  assert.match(page, /snapshot = await loadTrip\(identifier\);/);
  assert.doesNotMatch(page, /\[DEMO\]/);
  assert.match(page, /emailInvitations=\{emailDeliveryAvailable\(\)\}/);
});

test("native checkboxes and radios default to the brand color", async () => {
  const tokens = await read("../../../packages/ui/src/tokens.css");
  assert.match(tokens, /^:root \{\n {2}color-scheme: light;\n.*\n {2}accent-color: var\(--cm-color-action\);/m);
});

test("money wrap-up says what is true after the ledger closes and after a recap is shared", async () => {
  const wrapUp = await read("./beta-money-wrap-up.tsx");
  assert.match(wrapUp, /\{ledgerClosed \? "What’s still open" : "Before closing the ledger"\}/);
  assert.match(wrapUp, /An organizer closes the ledger once the group has added everything\./);
  assert.match(wrapUp, /placeholder="Bank transfer on Friday"/);
  assert.doesNotMatch(wrapUp, /Venmo|closes the ledger above|Saving again updates what they see/);
  // Saving a draft sets the recap back to draft on the server, so a shared recap stops being shared.
  assert.match(wrapUp, /Save draft hides it from the group until you share it again\./);
  assert.match(wrapUp, /Draft saved\. The group no longer sees the recap until you share it again\./);
});
