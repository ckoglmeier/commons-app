import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Trip · Plan · Money: rail and Menu share one list, and the trip page mounts no Coordinator", async () => {
  const navigation = await readFile(new URL("./event-navigation.tsx", import.meta.url), "utf8");
  const shell = await readFile(new URL("./trip-application-shell.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/c/[slug]/page.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(navigation, /coordinator/i);
  assert.doesNotMatch(shell, /coordinator/i);
  assert.doesNotMatch(page, /coordinator/i);
  assert.match(app, /<TripTasks showSuggestions=\{false\} slug=\{initialSnapshot\.commons\.id\}/, "ordinary to-dos are on Trip, once");
});
