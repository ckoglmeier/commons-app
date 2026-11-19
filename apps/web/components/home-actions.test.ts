import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { registerComponentImportStubs } from "../lib/test-support/hook-harness";

registerComponentImportStubs();

test("Home uses progressive shortcuts", async () => {
  const actions = await readFile(new URL("./home-dashboard.tsx", import.meta.url), "utf8");
  assert.match(actions, /!shortcuts.hasPlans/);
  assert.match(actions, /LogisticsAddMenu[^>]*choose=\{addPlan\}/);
  assert.match(actions, /Ask the group/);
});

test("there is no plan import: nothing offers to import or to email a person for help", async () => {
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  const actions = await readFile(new URL("./home-dashboard.tsx", import.meta.url), "utf8");
  for (const source of [app, actions]) assert.doesNotMatch(source, /Import plans|ConciergeImportSheet|Talk to Casey/);
});
