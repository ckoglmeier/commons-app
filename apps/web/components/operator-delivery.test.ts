import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("daily email recovery stays content-free and usable on narrow phones", async () => {
  const [page, css, tokens] = await Promise.all([
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../../../packages/ui/src/tokens.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<h2>Daily emails<\/h2>/);
  assert.match(page, /eventCount/);
  assert.match(page, /retryDailyEmail/);
  assert.match(page, /<h2>Find an account<\/h2>/);
  assert.match(page, /Search by name or exact email/);
  assert.match(page, /Search the exact email to change access/);
  assert.match(page, /requesterEmail/);
  assert.doesNotMatch(page, /\.payload/);
  assert.match(css, /\.operator-search input \{[\s\S]*?min-height: var\(--cm-touch-target\)[\s\S]*?font-size: 1rem/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.operator-search > div \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.operator-row \{ align-items: stretch; flex-direction: column; \}/);
  assert.match(css, /\.operator-row form, \.operator-row button, \.operator-row > a \{ width: 100%; \}/);
  assert.match(css, /\.operator-row button, \.operator-row > a \{ min-height: var\(--cm-touch-target\)/);
  assert.match(tokens, /--cm-touch-target:\s*2\.75rem/);
});
