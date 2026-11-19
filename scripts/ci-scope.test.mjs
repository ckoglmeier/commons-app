import assert from "node:assert/strict";
import test from "node:test";
import { requiresCodeChecks } from "./ci-scope.mjs";
const event = { event: "pull_request", base: "abc", head: "def" };
test("documentation allowlist and mixed changes", () => {
  assert.equal(requiresCodeChecks(event, () => "docs/plan.md\0README.md\0"), false);
  for (const paths of ["docs/plan.md\0apps/web/page.tsx\0", "DESIGN.md\0", ".github/workflows/ci.yml\0", "docs/tool.js\0", "scripts/ci-scope.mjs\0", ""]) {
    assert.equal(requiresCodeChecks(event, () => paths), true);
  }
});
test("manual runs, missing history, and errors fail safe", () => {
  for (const change of [{ event: "workflow_dispatch" }, { base: "0000" }, { base: "" }])
    assert.equal(requiresCodeChecks({ ...event, ...change }, () => "README.md\0"), true);
  assert.equal(requiresCodeChecks(event, () => { throw new Error("missing commit"); }), true);
});
