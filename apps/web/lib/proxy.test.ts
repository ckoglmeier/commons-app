import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy, shouldPreserveVercelCronHost } from "../proxy";

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

test("retired sample pages return home and sample APIs are gone", async () => {
  for (const id of ["10000000-0000-4000-8000-000000000001", "cape-cod-couples-week", "austin-weekend"]) {
    const page = await proxy(new NextRequest(`http://localhost/c/${id}/?conversation=1`));
    assert.equal(page.status, 307);
    assert.equal(page.headers.get("location"), "http://localhost/");
    const api = await proxy(new NextRequest(`http://localhost/api/v1/commons/${id}/state/`));
    assert.equal(api.status, 410);
  }
});
