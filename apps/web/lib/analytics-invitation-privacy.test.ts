import test from "node:test";
import assert from "node:assert/strict";
import { redactInvitationPath, sensitiveAnalyticsPath } from "./analytics-invitation-privacy";
import { accountCreationPath, safeAuthNext } from "./auth-flow";
import { groupInvitationPath } from "./group-invitation";
import { trackProductEvent } from "./product-analytics";
import { installFakeBrowserEnvironment } from "./test-support/fake-browser-environment";

test("group invitation survives sign-in/account setup without leaking its bearer into telemetry", () => {
  const token = `g_${"a".repeat(32)}`, next = groupInvitationPath(token);
  assert.equal(safeAuthNext(next), next);
  assert.equal(new URL(accountCreationPath(next, "invited"), "http://localhost").searchParams.get("next"), next);
  for (const path of [next, `/sign-in?next=${encodeURIComponent(next)}`, accountCreationPath(next, "invited"), `/account/create/?next=${encodeURIComponent(encodeURIComponent(next))}`, "/auth/confirm/"]) {
    assert.equal(sensitiveAnalyticsPath(path), true);
    assert.doesNotMatch(redactInvitationPath(path), new RegExp(token));
  }
});

test("the lower-level tracker sends nothing from auth/account/group invite paths", () => {
  const calls: string[] = [], live = installFakeBrowserEnvironment({ pathname: "/account/create/", fetch: async url => { calls.push(url); return Response.json({}); } });
  try {
    for (const path of ["/account/create/", "/sign-in/", "/group-join/g_private/", "/auth/confirm/"]) { window.location.pathname = path; trackProductEvent("page_view"); }
    assert.deepEqual(calls, []);
  } finally { live.restore(); }
});
