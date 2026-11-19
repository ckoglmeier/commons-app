import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventDaySelector } from "./event-day-selector";
import { readFile } from "node:fs/promises";
test("shared day selector preserves real buttons, current day, All and Unsorted", () => {
  const html = renderToStaticMarkup(createElement(EventDaySelector, { days: [{ id: "all", day: "All", date: "" }, { id: "unsorted", day: "Unsorted", date: "" }], selected: "unsorted", select() {}, label: "Photo days" }));
  assert.match(html, /role="tablist" aria-label="Photo days"/);
  assert.match(html, /aria-selected="true"/);
  assert.match(html, /Unsorted/);
});
test("Plan and Photos share the selector; Ask the group precedes Add plan", async () => {
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  assert.equal((app.match(/<EventDaySelector /g) ?? []).length, 2);
  assert.doesNotMatch(app, /photo-day-organizer|plan-related-links/);
  assert.match(app, /QuestionIcon \/> Ask the group/);
  const people = await readFile(new URL("./people-sheet.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(people, /joined:.*accessMode !== "managed"/);
});
