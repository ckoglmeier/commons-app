import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("shared action feedback is available without motion and helper text stays readable", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const feedback = css.split("/* Action links and buttons share feedback")[1];
  const staticStates = feedback.split("@media (prefers-reduced-motion: no-preference)")[0];
  assert.match(staticStates, /:active.*--cm-color-action-pressed/);
  assert.match(staticStates, /:active.*--cm-color-secondary-pressed/);
  assert.match(staticStates, /:hover:not\(:active\)/);
  assert.match(staticStates, /:not\(:disabled\):not\(\[aria-disabled="true"\]\)/);
  assert.match(css, /\.sheet-footnote \{[^}]*font-size: var\(--cm-text-utility\)/);
  assert.match(css, /\.trip-navigation-menu a.active \{[^}]*text-decoration: underline/);
});

test("action and helper color combinations meet normal-text AA in each state", async () => {
  const tokens = await readFile(new URL("../../../packages/ui/src/tokens.css", import.meta.url), "utf8");
  const colors = Object.fromEntries([...tokens.matchAll(/--cm-color-([\w-]+):\s*(#[0-9a-f]{6});/g)].map(m => [m[1], m[2]]));
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/../g)!.map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  for (const [foreground, background] of [["paper", "ink"], ["paper", "green"], ["paper", "action-pressed"], ["ink", "paper"], ["ink", "green-wash"], ["ink", "secondary-pressed"], ["mineral", "canvas"], ["mineral", "paper"], ["ink", "coral"], ["ember", "paper"]]) {
    const a = luminance(colors[foreground]);
    const b = luminance(colors[background]);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${foreground} on ${background}`);
  }
});
