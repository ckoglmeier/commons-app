import test from "node:test";
import assert from "node:assert/strict";
import { planItinerary } from "./coordinator-itinerary-inference";

const input = { request: "Make Friday slower", itinerary: { title: "Synthetic weekend" }, tripContext: { trip: { timezone: "America/Los_Angeles" } }, organizerIntent: "Easy pace", conversation: [] };
const config = { apiKey: "synthetic-key", model: "configured-planner", transport: "openai" as const, providerPolicy: "private" as const };
const completion = (content: unknown, finish_reason = "stop") => new Response(JSON.stringify({ choices: [{ finish_reason, message: { content: JSON.stringify(content) } }] }), { headers: { "content-type": "application/json" } });
test("planner uses the configured transport/model, strict operations, no tools and metadata-only telemetry", async () => {
  let body: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  let url = "", observed: unknown;
  const fake: typeof fetch = async (target, init) => { url = String(target); body = JSON.parse(String(init?.body)); return completion({ reply: "What should we keep?", operations: [] }); };
  assert.equal((await planItinerary(input, { ...config, telemetry: value => { observed = value; } }, undefined, fake)).reply, "What should we keep?");
  assert.equal(url, "https://api.openai.com/v1/chat/completions"); assert.equal(body.model, config.model);
  assert.equal(body.tools, undefined); assert.equal(body.stream, false);
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(JSON.parse(body.messages.at(-1).content).organizerIntent, "Easy pace");
  assert.ok(!JSON.stringify(observed).includes(input.request));
  await planItinerary(input, { ...config, transport: "openrouter" }, undefined, fake);
  assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
  assert.deepEqual(body.provider, { require_parameters: true, data_collection: "deny", zdr: true });
});
test("truncation, refusal, tool calls, invalid schema, HTTP and cancellation never yield a usable proposal", async () => {
  const responses = [completion({ reply: "Done", operations: [] }, "length"), completion({ reply: "Done", operations: [{ kind: "book" }] }), new Response("no", { status: 500 }),
    new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"reply":"done","operations":[]}', refusal: "No" } }] }))];
  for (const response of responses) await assert.rejects(planItinerary(input, config, undefined, async () => response));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(planItinerary(input, config, abort.signal, async (_target, init) => { init?.signal?.throwIfAborted(); return completion({ reply: "Done", operations: [] }); }));
});
