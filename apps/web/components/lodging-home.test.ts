import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Home exposes its selected stay as a Maps shortcut", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("./home-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /shortcuts.stay/);
  assert.match(source, /https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.doesNotMatch(source, /maps\.apple\.com\/\?daddr=/);
  assert.match(css, /\.lodging-card__actions \{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /min-height: var\(--cm-touch-target\)/);
});

test("Stay costs remain editable planning data without adding density to the home row", async () => {
  const source = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");

  assert.match(source, /Planning amount only\. This does not record a payment or add an expense\./);
  assert.match(source, /From confirmation/);
  assert.match(source, /Taxes and fees/);
  const home = await readFile(new URL("./home-dashboard.tsx", import.meta.url), "utf8");
  assert.match(home, /home-shortcut/);
  assert.doesNotMatch(source, /lodging-card__cost/);
});
