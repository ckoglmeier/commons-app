import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps reusable travel preferences private and human-controlled", async () => {
  const [form, page, people, route] = await Promise.all([
    readFile(new URL("./traveler-preferences-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/profile/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("./people-sheet.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/commons/[slug]/people/[personId]/profile/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(form, /Nothing is shared with a trip automatically/);
  assert.match(form, /We’ll ask before using or sharing them for a trip/);
  assert.match(form, /Last updated by/);
  for (const label of ["Usual starting point", "Food and dietary needs", "Accessibility needs", "Lodging preferences", "Transportation preferences"]) {
    assert.match(form, new RegExp(label));
  }
  assert.match(page, /TravelerPreferencesForm/);
  assert.match(people, /managedByPersonIds\?\.includes\(data\.currentPersonId\)/);
  assert.match(people, /Edit private travel details/);
  assert.match(route, /TravelerProfileAccessError/);
});

test("keeps preference controls usable at mobile widths", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /traveler-preferences__actions button[^}]*min-height:\s*var\(--cm-touch-target\)/s);
  assert.match(css, /traveler-preferences[^}]*width:\s*min\(100%, 42rem\)/s);
});
