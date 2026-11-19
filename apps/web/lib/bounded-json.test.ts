import assert from "node:assert/strict";
import test from "node:test";
import { COORDINATOR_WORKSPACE_BODY_LIMIT, readBoundedJson } from "./bounded-json";

test("small command JSON is bounded with or without declared length", async () => {
  assert.deepEqual(await readBoundedJson(new Request("https://commons.test", { method: "POST", body: '{"approved":true}' })), { approved: true });
  await assert.rejects(readBoundedJson(new Request("https://commons.test", { method: "POST", body: "{}", headers: { "content-length": "10000" } })), SyntaxError);
  await assert.rejects(readBoundedJson(new Request("https://commons.test", { method: "POST", body: JSON.stringify({ value: "a".repeat(5000) }) })), SyntaxError);
  await assert.rejects(readBoundedJson(new Request("https://commons.test", { method: "POST", body: "not JSON" })), SyntaxError);
});

test("workspace limit still rejects oversized declared and streamed bodies", async () => {
  for (const declared of [false, true]) {
    const body = JSON.stringify({ value: "a".repeat(COORDINATOR_WORKSPACE_BODY_LIMIT) });
    await assert.rejects(readBoundedJson(new Request("https://commons.test", {
      method: "PATCH", body,
      ...(declared ? { headers: { "content-length": String(Buffer.byteLength(body)) } } : {}),
    }), COORDINATOR_WORKSPACE_BODY_LIMIT), /Command too large/);
  }
});
