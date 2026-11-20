import test from "node:test";
import assert from "node:assert/strict";
import { registerComponentImportStubs } from "../test-support/hook-harness";
registerComponentImportStubs();

test("group invitation writes bind the configured public origin, never a forwarded host", async () => {
  const { groupInvitationBody } = await import("./group-invitation-http");
  const saved = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://trips.example.test";
  const request = (origin: string, extra: Record<string, string> = {}) => new Request("http://internal:4244/api/invite", {
    method: "POST", headers: { origin, "content-type": "application/json", ...extra }, body: '{"reviewed":true}',
  });
  try {
    assert.deepEqual(await groupInvitationBody(request("https://trips.example.test")), { reviewed: true });
    await assert.rejects(groupInvitationBody(request("https://example.test")), "only the exact configured origin");
    for (const origin of ["https://evil.test", "https://other.example.test", "null"]) {
      await assert.rejects(groupInvitationBody(request(origin, { "x-forwarded-host": origin.replace("https://", "") })));
    }
    await assert.rejects(groupInvitationBody(request("https://trips.example.test", { "sec-fetch-site": "cross-site" })));
    await assert.rejects(groupInvitationBody(new Request("http://internal/api/invite", { method: "POST", headers: { origin: "https://trips.example.test", "content-type": "application/json" }, body: "x".repeat(2049) })));
  } finally { if (saved === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = saved; }
});

test("only the exact server deployment origin is trusted for previews", async () => {
  const { groupInvitationBody } = await import("./group-invitation-http");
  const saved = { ...process.env };
  Object.assign(process.env, { NEXT_PUBLIC_SITE_URL: "https://trips.example.test", VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "commons-reviewed-preview.vercel.app" });
  const request = (origin: string, extra: Record<string,string> = {}) => new Request("http://internal/api/invite", { method: "POST", headers: { origin, "content-type": "application/json", ...extra }, body: "{}" });
  try {
    assert.deepEqual(await groupInvitationBody(request("https://commons-reviewed-preview.vercel.app")), {});
    await assert.rejects(groupInvitationBody(request("https://other-project.vercel.app", { "x-forwarded-host": "other-project.vercel.app" })));
    await assert.rejects(groupInvitationBody(request("https://commons-reviewed-preview.vercel.app", { "sec-fetch-site": "cross-site" })));
    await assert.rejects(groupInvitationBody(request("http://trips.example.test")));
  } finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env,saved); }
});

test("an invitation failure carries Commons's own words, never a driver's query", async (t) => {
  const { groupInvitationFailure } = await import("./group-invitation-http");
  const { CommonsMembershipRequiredError } = await import("./commons-access-errors");
  t.mock.method(console, "error", () => {});
  const outsider = groupInvitationFailure(new CommonsMembershipRequiredError());
  assert.equal(outsider.status, 403);
  assert.equal((await outsider.json()).error, "You aren’t on this trip.");
  const driver = groupInvitationFailure(Object.assign(new Error("Failed query: select \"id\" from \"people\"\nparams: 1"), { query: "select", params: [] }));
  assert.equal(driver.status, 500);
  assert.doesNotMatch((await driver.json()).error, /select|Failed query/);
});
