import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React,{ createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventNavigationLinks } from "./event-navigation";
import type { EventView } from "../lib/commons-route";

test("desktop and mobile share the same real destination links", async () => {
  const source = await readFile(new URL("./event-navigation.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  assert.deepEqual([...source.matchAll(/id: "(\w+)", label:/g)].map(match => match[1]), ["home", "plan", "money", "moments"]);
  assert.match(source, /item\.id !== "moments" \|\| tripStage !== null/, "Photos only appears on the new experience, so other trips keep four");
  assert.match(source, /href=\{commonsViewPath/);
  assert.match(source, /aria-current=/);
  assert.match(source, /event.metaKey \|\| event.ctrlKey/);
  assert.equal((app.match(/<EventNavigationLinks /g) ?? []).length, 0);
  assert.match(app, /useSearchParams\(\)/);
  assert.doesNotMatch(app, /dispatchEvent\(new PopStateEvent/);
  assert.match(app, /useState<Tab>\(initialView\)/);
  assert.doesNotMatch(app, /function TripDetailsSheet|setSheet\("trip-details"\)|Lodging not added/);
});

test("Photos is contextual under Trip and Travel & stays belongs to Plan in the shared destination links", () => {
  Object.assign(globalThis, { React });
  const current = (view: EventView) => [...renderToStaticMarkup(createElement(EventNavigationLinks, { eventId: "trip", view, navigate() {} })).matchAll(/aria-current="page"[^>]*><svg[\s\S]*?<span>(.*?)<\/span>/g)].map(match => match[1]);
  assert.deepEqual(current("moments"), ["Trip"]);
  assert.deepEqual(current("home"), ["Trip"]);
  assert.deepEqual(current("logistics"), ["Plan"]);
  const html = renderToStaticMarkup(createElement(EventNavigationLinks, { eventId: "trip", view: "plan", navigate() {} }));
  assert.match(html, /href="\/c\/trip\?arrival=0&amp;view=money"/, "links keep real hrefs for new-tab and modified clicks");
});
