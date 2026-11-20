import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./modal-layer.tsx", import.meta.url), "utf8");

// Source-text test: the repo's hook harness has no DOM or selector engine, so the selectors are checked as written.
test("the focus trap and first focus skip anything Tab can never reach", () => {
  const selectors = [...source.matchAll(/querySelector(?:All)?<HTMLElement>\("([^"]+)"\)/g)].map(match => match[1]);
  const initial = selectors.find(selector => selector.startsWith(".sheet "));
  const trap = selectors.find(selector => selector.startsWith("button:"));
  assert.ok(initial && trap);
  for (const selector of [initial, trap]) {
    for (const part of selector.split(/,\s*/)) assert.match(part, /:not\(\[tabindex='-1'\]\)$/, `${part} must exclude tabindex="-1"`);
  }
  for (const kind of ["button", "input", "select", "textarea", "summary", "[href]"]) {
    assert.ok(trap.split(/,\s*/).some(part => part.startsWith(kind)), `the trap includes ${kind}`);
  }
});
