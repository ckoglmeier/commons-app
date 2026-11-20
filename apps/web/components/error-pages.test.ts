import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

for (const path of ["app/error.tsx", "app/global-error.tsx"]) {
  test(`${path} says what happened and what to do next, never the error's own text`, () => {
    const page = read(path);
    assert.match(page, /^"use client";/);
    assert.match(page, /<title>Something went wrong — Commons<\/title>/);
    assert.match(page, /<span className="view-kicker">Something went wrong<\/span>/);
    assert.match(page, /<h1>This page didn’t load\.<\/h1>/);
    assert.match(page, /Try again in a moment\. If it keeps happening, tell the person who runs this copy of Commons\./);
    assert.match(page, /<p className="entry-footnote">Run this copy\? The server log has the details\. The usual causes are a database that can’t be reached or hasn’t been set up\.<\/p>/);
    assert.match(page, /Reference: \{digest\}/);
    assert.match(page, /<button className="join-primary" type="button" onClick=\{\(\) => retry\(\)\}>Try again<\/button>/);
    assert.match(page, /className="sheet-secondary" href="\/trips">Go to your trips</);
    assert.doesNotMatch(page, /error\.message|\.stack/);
  });
}

test("the global error page renders its own document", () => {
  const page = read("app/global-error.tsx");
  assert.match(page, /<html lang="en">/);
  assert.match(page, /<body/);
  assert.match(page, /import "\.\/globals\.css";/);
});
