import assert from "node:assert/strict";
import test from "node:test";
import { EmailDeliveryError } from "../email/resend";
import { runOperatorNotification } from "./operator-notification-worker";
import { readCommonsRuntimeEnvironment } from "./runtime-environment";

const job = { skipped: false as const, id: "qa-notice", attempt: 1,
  payload: { kind: "beta_access" as const, email: "requester@example.com", personId: "qa" } };

test("operator notifications go only to the configured founder inbox with a stable delivery key", async () => {
  const recipient = readCommonsRuntimeEnvironment({ NODE_ENV: "test" }).COMMONS_OPERATOR_NOTIFICATION_EMAIL;
  assert.equal(recipient, "organizer@example.com");
  const result = await runOperatorNotification("https://www.commons.travel", recipient, {
    lease: async () => job,
    send: async input => { assert.equal(input.to, recipient); assert.equal(input.idempotencyKey, "commons-operator-qa-notice"); return { id: "provider-id" }; },
    complete: async (id, attempt, value) => { assert.equal(id, job.id); assert.equal(attempt, 1); assert.deepEqual(value, { sent: true, providerMessageId: "provider-id" }); return true; },
  });
  assert.deepEqual(result, { id: job.id, status: "sent" });
});

test("provider failures persist a safe retry classification without exposing private data", async () => {
  const result = await runOperatorNotification("https://www.commons.travel", "operator@example.com", {
    lease: async () => job,
    send: async () => { throw new EmailDeliveryError("provider_unavailable", "private provider response"); },
    complete: async (_id, _attempt, value) => { assert.deepEqual(value, { sent: false, errorCode: "provider_unavailable" }); return true; },
  });
  assert.deepEqual(result, { id: job.id, status: "retry_queued" });
});

test("already delivered or leased notifications do not send again", async () => {
  assert.equal(await runOperatorNotification("https://www.commons.travel", "operator@example.com", {
    lease: async () => null,
    send: async () => assert.fail("Must not send"), complete: async () => assert.fail("Must not complete"),
  }), null);
});
