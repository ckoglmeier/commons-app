import test from "node:test";
import assert from "node:assert/strict";
import { partialJsonString, readCompletionStream } from "./provider-stream";
import { guardModelReply, replyStreamGuard, type ReplyGuardOptions } from "./coordinator-claims";

function sse(parts: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({ start(controller) { for (const part of parts) controller.enqueue(encoder.encode(part)); controller.close(); } });
}
const chunk = (content: string, extra: Record<string, unknown> = {}) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }], ...extra })}\n\n`;

test("partialJsonString decodes a reply that is still arriving, and never shows half an escape or half an emoji", () => {
  const full = JSON.stringify({ reply: "Line one.\nShe said \"5 p.m.\" 🍝 – café", topicTitle: "Dinner" });
  const seen: string[] = [];
  for (let end = 0; end <= full.length; end += 1) {
    const value = partialJsonString(full.slice(0, end), "reply");
    if (value) seen.push(value.value);
  }
  for (const [index, value] of seen.entries()) if (index) assert.ok(value.startsWith(seen[index - 1]), `monotonic at ${index}: ${JSON.stringify(value)}`);
  assert.equal(seen.at(-1), "Line one.\nShe said \"5 p.m.\" 🍝 – café");
  assert.ok(seen.every(value => !value.endsWith("\\") && !/[\uD800-\uDBFF]$/.test(value)));
  assert.deepEqual(partialJsonString(full, "reply"), { value: "Line one.\nShe said \"5 p.m.\" 🍝 – café", complete: true });
  assert.equal(partialJsonString('{"topicTitle":"x"', "reply"), null);
  // A quoted "reply": inside another string value is escaped and never matches.
  assert.equal(partialJsonString(JSON.stringify({ threadSummary: 'He wrote "reply":"booked"' }), "reply"), null);
});

test("readCompletionStream joins events split across writes, skips comments, and reports usage and finish", async () => {
  const texts: string[] = [];
  const body = [": OPENROUTER PROCESSING\n\n", chunk('{"reply":"Hel').slice(0, 11), chunk('{"reply":"Hel').slice(11), chunk('lo."}'),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 3, cost: 0.0001 } })}\n\n`, "data: [DONE]\n\n", chunk("ignored")];
  const result = await readCompletionStream(sse(body), text => texts.push(text));
  assert.equal(result.text, '{"reply":"Hello."}');
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.usage, { prompt_tokens: 10, completion_tokens: 3, cost: 0.0001 });
  assert.deepEqual(texts, ['{"reply":"Hel', '{"reply":"Hello."}']);
  const failed = await readCompletionStream(sse([chunk('{"reply":"Hi'), `data: ${JSON.stringify({ error: { code: 502 }, choices: [{ delta: { content: "" }, finish_reason: "error" }] })}\n\n`]), () => {});
  assert.deepEqual(failed.error, { code: 502 });
  assert.equal(failed.finishReason, "error");
  const garbled = await readCompletionStream(sse(["data: {not json\n\n"]), () => {});
  assert.equal(garbled.error, "unreadable_chunk");
});

const plain: ReplyGuardOptions = { created: {}, tripChanges: { enabled: true } };
function streamAll(reply: string, options: ReplyGuardOptions, step = 1) {
  const guard = replyStreamGuard(options), shown: string[] = [];
  for (let end = step; end <= reply.length + step; end += step) { const next = guard.next(reply.slice(0, end)); if (next) shown.push(next); }
  return shown;
}

test("the stream guard releases only complete sentences the full guard keeps, and what it shows is always a prefix of the saved reply", () => {
  const replies = [
    "Alpine Table opens at 4:30. It is a short walk from the lodge. Prices are unverified.",
    "Try Ridge Grill at 5 p.m. and ask for a booth. I've booked a table for six. Kids eat free on Fridays.",
    "I've prepared a trip update for your review. Nothing is saved until you apply it.",
    "Plan for 5. Review and apply the suggested update below. Then head out.",
    "Early dinner works. Nothing will be changed until you approve it. Enjoy.",
    "One sentence with no ending",
  ];
  for (const reply of replies) for (const step of [1, 3, 17]) {
    const shown = streamAll(reply, plain, step);
    const saved = guardModelReply(reply, plain).text;
    for (const text of shown) assert.ok(saved.replace(/\s+/g, " ").startsWith(text), `${JSON.stringify(text)} is not a prefix of ${JSON.stringify(saved)}`);
    assert.ok(shown.every(text => !/booked|prepared a trip update|apply the suggested|until you approve/i.test(text)), JSON.stringify(shown));
  }
  assert.deepEqual(streamAll(replies[0], plain), ["Alpine Table opens at 4:30.", "Alpine Table opens at 4:30. It is a short walk from the lodge."],
    "the last sentence waits for the saved reply, because the stream cannot know it is complete");
  assert.deepEqual(streamAll(replies[1], plain), ["Try Ridge Grill at 5 p.m. and ask for a booth."], "frozen at the booking claim; nothing after it streams");
  assert.deepEqual(streamAll(replies[2], plain), []);
  assert.deepEqual(streamAll(replies[4], plain), ["Early dinner works."], "a 'nothing … until' follow-up is held back");
});

test("the stream guard uses the turn's own rules: trip changes turned off also hold back an offer to prepare one", () => {
  const off: ReplyGuardOptions = { created: {}, tripChanges: { enabled: false } };
  const reply = "Dinner at 5 is easy. I can prepare a plan update for that. See you there.";
  assert.deepEqual(streamAll(reply, plain), ["Dinner at 5 is easy.", "Dinner at 5 is easy. I can prepare a plan update for that."]);
  assert.deepEqual(streamAll(reply, off), ["Dinner at 5 is easy."]);
});
