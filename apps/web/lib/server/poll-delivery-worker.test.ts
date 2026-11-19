import assert from "node:assert/strict";
import test from "node:test";
import { runPollDelivery } from "./poll-delivery-worker";
import { EmailDeliveryError } from "../email/resend";
const origin = "https://www.commons.travel";
const job = { skipped: false as const, id: "job-1", attempt: 2, email: "selected@example.test", publicId: "abcdef123456" };

test("delivery revalidates before sending only the reviewed link using a stable provider key", async () => {
  const order: string[] = [];
  const result = await runPollDelivery(origin, {
    lease: async () => job,
    revalidate: async (id, attempt) => { assert.equal(id, job.id); assert.equal(attempt, 2); order.push("check"); return true; },
    send: async input => { order.push("send"); assert.equal(input.to, job.email); assert.equal(input.idempotencyKey, "commons-poll-job-1"); assert.match(input.text, /\/c\/poll\/abcdef123456/); assert.equal(Object.keys(input).length, 5); return { id: "message" }; },
    complete: async (id, attempt, sent) => { order.push("complete"); assert.equal(id, job.id); assert.equal(attempt, 2); assert.deepEqual(sent, { sent: true, providerMessageId: "message" }); return true; },
  });
  assert.deepEqual(order, ["check", "send", "complete"]);
  assert.deepEqual(result, { id: job.id, status: "sent" });
  assert.doesNotMatch(JSON.stringify(result), /selected|example|abcdef/);
});

test("revoked access never sends, and a lost lease never claims a saved result", async () => {
  const deps = { lease: async () => job, revalidate: async () => false,
    send: async () => { throw new Error("must not send"); }, complete: async () => true };
  assert.deepEqual(await runPollDelivery(origin, deps), { id: job.id, status: "cancelled" });
  assert.deepEqual(await runPollDelivery(origin, { ...deps, complete: async () => false }), { id: job.id, status: "lease_changed" });
});

test("provider rejection is visible to maintainers without leaking provider response content", async () => {
  let code;
  const result = await runPollDelivery(origin, { lease: async () => job, revalidate: async () => true,
    send: async () => { throw new EmailDeliveryError("provider_rejected", "private provider response"); },
    complete: async (_id, _attempt, outcome) => { code = outcome.errorCode; return true; } });
  assert.equal(code, "provider_rejected"); assert.equal(result && !('skipped' in result) ? result.status : null, "failed");
  assert.doesNotMatch(JSON.stringify(result), /private provider/);
});
