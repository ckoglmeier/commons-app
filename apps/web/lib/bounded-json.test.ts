import assert from "node:assert/strict";
import test from "node:test";
import { COORDINATOR_WORKSPACE_BODY_LIMIT, readBoundedJson } from "./bounded-json";
import { ItineraryContentSchema } from "@commons/contracts";
import { readFileSync } from "node:fs";

test("small command JSON is bounded with or without declared length", async () => {
  assert.deepEqual(await readBoundedJson(new Request("https://commons.test", { method: "POST", body: '{"approved":true}' })), { approved: true });
  await assert.rejects(readBoundedJson(new Request("https://commons.test", { method: "POST", body: "{}", headers: { "content-length": "10000" } })), SyntaxError);
  await assert.rejects(readBoundedJson(new Request("https://commons.test", { method: "POST", body: JSON.stringify({ value: "a".repeat(5000) }) })), SyntaxError);
  await assert.rejects(readBoundedJson(new Request("https://commons.test", { method: "POST", body: "not JSON" })), SyntaxError);
});

test("workspace saves accept full itinerary revisions beyond the former 8 KB limit", async () => {
  const content = ItineraryContentSchema.parse({
    title: "Synthetic Thursday–Saturday itinerary", brief: "A group weekend.",
    items: Array.from({ length: 30 }, (_, i) => ({
      id: `item-${i}`, kind: "activity", title: `Stop ${i}`, day: "2026-11-05", time: null,
      location: "Sonoma", note: "Organizer context. ".repeat(60), participantNote: "Enjoy the afternoon.",
      participation: "group", alternative: false, evidence: "suggestion", sources: [], unresolved: [],
    })), driverBrief: "", tasks: [], unresolved: [],
  });
  const command = { action: "itinerary", operation: "revise", content };
  const body = JSON.stringify(command);
  assert.ok(Buffer.byteLength(body) > 8000);
  await assert.rejects(readBoundedJson(new Request("https://commons.test", { method: "PATCH", body }), 8000), SyntaxError);
  assert.deepEqual(await readBoundedJson(new Request("https://commons.test", { method: "PATCH", body }), COORDINATOR_WORKSPACE_BODY_LIMIT), command);
  const route = readFileSync(new URL("../app/api/v1/commons/[slug]/coordinator/route.ts", import.meta.url), "utf8");
  assert.match(route, /readBoundedJson\(request, COORDINATOR_WORKSPACE_BODY_LIMIT\)/);
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
