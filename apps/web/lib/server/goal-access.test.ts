import test from "node:test";
import assert from "node:assert/strict";
import { registerComponentImportStubs } from "../test-support/hook-harness";
registerComponentImportStubs();

const trip = "96000000-0000-4000-8000-0000000000aa";
const pilot = { COMMONS_COORDINATOR_GOALS_PILOT_ENABLED: "true", COMMONS_RECIPES_PILOT_EMAILS: "pilot@example.com", COMMONS_RECIPES_PILOT_TRIP_IDS: trip };

test("unknown trips fail closed and cannot inherit global Goal or recipe access", async () => {
  const { coordinatorGoalsAvailableFor } = await import("./goal-access");
  assert.equal(await coordinatorGoalsAvailableFor(trip, {}), false, "an unknown trip has no explicit pilot access");
  const off = { COMMONS_COORDINATOR_GOALS_ENABLED: "false" };
  assert.equal(await coordinatorGoalsAvailableFor(trip, off), false);
  assert.equal(await coordinatorGoalsAvailableFor(trip, { ...off, COMMONS_RECIPES_ENABLED: "true" }), false);
  assert.equal(await coordinatorGoalsAvailableFor(trip, { ...off, ...pilot }), false, "listed trip without verified session");
  assert.equal(await coordinatorGoalsAvailableFor(trip, { ...off, ...pilot, COMMONS_RECIPES_ENABLED: "true" }), false);
  assert.equal(await coordinatorGoalsAvailableFor(trip, { COMMONS_COORDINATOR_GOALS_ENABLED: "true" }), false, "global Goals cannot grant trip capability");
});

test("both Goal route aliases reject pilot writes without verified identity", async () => {
  const prior = { ...process.env };
  Object.assign(process.env, pilot, { COMMONS_COORDINATOR_GOALS_ENABLED: "false", COMMONS_RECIPES_ENABLED: "true" });
  try {
    const canonical = await import("../../app/api/v1/commons/[slug]/goals/route");
    const legacy = await import("../../app/api/v1/commons/[slug]/coordinator/goals/route");
    const context = { params: Promise.resolve({ slug: trip }) };
    for (const route of [canonical, legacy]) {
      const read = await route.GET(new Request("http://localhost/goals"), context);
      assert.deepEqual(await read.json(), { enabled: false, goals: [], reports: [], suggestions: [] });
      const write = await route.POST(new Request("http://localhost/goals", { method: "POST", body: JSON.stringify({ op: "start", commandId: crypto.randomUUID(), kind: "planning", title: "Test", goal: "Find a fit", workflowRunId: crypto.randomUUID() }) }), context);
      assert.ok(write.status >= 400, "no creation through a direct POST");
      const dismiss = await route.PATCH(new Request("http://localhost/goals", { method: "PATCH", body: "{}" }), context);
      assert.equal(dismiss.status, 403);
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
    Object.assign(process.env, prior);
  }
});
