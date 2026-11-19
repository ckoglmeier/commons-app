import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CommandConflictError } from "@commons/database";
import { workflowAdminHandlers } from "./workflow-admin-route";

const request = (method = "POST", body: unknown = {}, origin = "https://commons.test") => new Request("https://commons.test/api/v1/admin/workflows", { method, headers: { origin, "content-type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
const definition = { key: "qa_custom", title: "QA", description: "Synthetic", purpose: "general_poll", instructions: "Write only a synthetic poll, never send or book." };
function handlers(authorized = true) {
  const calls: string[] = [];
  const template = { ...definition, purpose: "general_poll" as const, id: randomUUID(), version: 1, status: "draft" as const, createdAt: new Date().toISOString() };
  return { calls, route: workflowAdminHandlers({ authorize: async () => authorized ? "qa-operator" : null,
    list: async () => { calls.push("list"); return [template]; }, save: async (_raw, operator) => { calls.push(operator); return template; }, activate: async () => { calls.push("activate"); return { ...template, status: "active" }; } }) };
}
test("anonymous and non-operator requests cannot read templates or mutate; origin is checked", async () => {
  const denied = handlers(false);
  for (const method of ["GET", "POST", "PATCH"] as const) assert.equal((await denied.route[method](request(method))).status, 403);
  assert.deepEqual(denied.calls, []);
  const allowed = handlers();
  assert.equal((await allowed.route.POST(request("POST", {}, "https://evil.test"))).status, 403);
  assert.deepEqual(allowed.calls, []);
});
test("bounded strict commands, no-store reads, explicit save and activation", async () => {
  const allowed = handlers();
  const read = await allowed.route.GET(request("GET"));
  assert.equal(read.headers.get("cache-control"), "private, no-store");
  assert.equal((await allowed.route.POST(request("POST", { commandId: randomUUID(), expectedLatestVersion: 0, definition }))).status, 200);
  assert.equal((await allowed.route.POST(request("POST", { commandId: randomUUID(), expectedLatestVersion: 0, definition: { ...definition, tools: ["send_email"] } }))).status, 400);
  assert.equal((await allowed.route.POST(request("POST", { instructions: "x".repeat(60_001) }))).status, 400);
  assert.deepEqual(allowed.calls, ["list", "qa-operator"]);
  assert.equal((await allowed.route.PATCH(request("PATCH", { commandId: randomUUID(), id: randomUUID(), expectedActiveId: null }))).status, 200);
});
test("stale writes return conflict and unexpected failures never echo private content", async () => {
  const route = workflowAdminHandlers({ authorize: async () => "operator", list: async () => { throw new Error("PRIVATE SQL SECRET"); }, save: async () => { throw new CommandConflictError(); }, activate: async () => { throw new Error("PRIVATE SQL SECRET"); } });
  assert.equal((await route.POST(request("POST", { commandId: randomUUID(), expectedLatestVersion: 0, definition }))).status, 409);
  const response = await route.GET(request("GET"));
  assert.equal(response.status, 500); assert.ok(!(await response.text()).includes("SECRET"));
});
