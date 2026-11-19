import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Trip · Plan · Money: rail and Menu share one list, and the navigation has no Coordinator entry", async () => {
  const navigation = await readFile(new URL("./event-navigation.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(navigation, /coordinator/i);
  assert.match(app, /<TripTasks showSuggestions=\{false\} slug=\{initialSnapshot\.commons\.id\}/, "ordinary to-dos are on Trip, once");
});
