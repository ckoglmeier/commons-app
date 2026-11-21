import assert from "node:assert/strict";
import test from "node:test";
import { shouldPreserveVercelCronHost } from "../proxy";

test("lets authenticated Vercel cron requests reach the protected internal handlers", () => {
  assert.equal(
    shouldPreserveVercelCronHost(
      "/api/internal/invitation-deliveries/",
      "Bearer scheduled-secret",
    ),
    true,
  );
});

test("keeps every other deployment-host request on the canonical redirect path", () => {
  assert.equal(shouldPreserveVercelCronHost("/api/internal/invitation-deliveries/", null), false);
  assert.equal(shouldPreserveVercelCronHost("/api/internal/invitation-deliveries/", "Basic token"), false);
  assert.equal(shouldPreserveVercelCronHost("/trips/", "Bearer scheduled-secret"), false);
});
