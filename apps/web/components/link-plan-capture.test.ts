import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the Plan sheet keeps link capture inside the reviewed add flow", async () => {
  const source = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  assert.match(source, /Add something you found/);
  assert.match(source, /Paste a hike, restaurant, map, or other link/);
  assert.match(source, /LinkPreviewSchema\.parse/);
  assert.match(source, /sourceUrl: linkPreview\?\.url \?\? null/);
  assert.match(source, /Details added below\. Review them before saving\./);
  assert.match(source, /Commons couldn’t read this page\. Check the title/);
  assert.match(source, /Boolean\(linkPreview\?\.existingItem\)/);
});

test("linked ideas and scheduled plans retain an inspectable source", async () => {
  const source = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  assert.match(source, /function PlanSourceLink/);
  assert.match(source, /idea\.sourceUrl \? <PlanSourceLink/);
  assert.match(source, /group\[0\]\.sourceUrl \? <PlanSourceLink/);
  assert.match(source, /target="_blank" rel="noreferrer"/);
});

test("link capture collapses to one column on narrow phones", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.plan-link-import__controls, \.plan-link-preview \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /min-height: var\(--cm-touch-target\)/);
});
