import assert from "node:assert/strict";
import test from "node:test";
import { registerComponentImportStubs } from "../test-support/hook-harness";
registerComponentImportStubs();
test("activity pilot defaults closed and a local pilot actor cannot grant verified account access", async () => {
  const { canUseActivityDecisions } = await import("./activity-decision-access");
  const { readCommonsRuntimeEnvironment } = await import("./runtime-environment");
  const environment = readCommonsRuntimeEnvironment({ NODE_ENV: "test" });
  assert.equal(environment.COMMONS_ACTIVITY_DECISIONS_PILOT_ENABLED, "false");
  assert.equal(await canUseActivityDecisions(environment), false);
  assert.equal(await canUseActivityDecisions({ ...environment, COMMONS_ACTIVITY_DECISIONS_PILOT_ENABLED: "true" }), false);
});
