import assert from "node:assert/strict";
import test from "node:test";
import { campaignFromSearch, deviceClass, sanitizeCampaignValue } from "./analytics-attribution";
import { safeProductEvent } from "./posthog-privacy";
import { sanitizedServerError } from "./server-error-report";

test("campaign attribution keeps only allowlisted utm slugs; everything else is withheld or 'other'", () => {
  assert.deepEqual(campaignFromSearch("?utm_source=Splitwise&utm_medium=cpc&utm_campaign=fall_trips-2026&gclid=abc&email=a@b.co&ref=https://x.invalid"),
    { utm_source: "splitwise", utm_medium: "cpc", utm_campaign: "fall_trips-2026" });
  assert.equal(sanitizeCampaignValue("someone@example.invalid"), "other");
  assert.equal(sanitizeCampaignValue("https://evil.invalid/?q=1"), "other");
  assert.equal(sanitizeCampaignValue("x".repeat(41)), "other");
  assert.equal(sanitizeCampaignValue(""), undefined);
  assert.equal(sanitizeCampaignValue(null), undefined);
});

test("device is a coarse class", () => {
  assert.equal(deviceClass(390), "mobile");
  assert.equal(deviceClass(430), "mobile");
  assert.equal(deviceClass(800), "tablet");
  assert.equal(deviceClass(1440), "desktop");
});

test("PostHog allowlist admits sample, role, campaign slugs and device class, and rejects free text", () => {
  const safe = safeProductEvent("$pageview", { sample: true, role: "participant", utm_source: "splitwise", utm_campaign: "Fall Trips!", deviceClass: "mobile", title: "Synthetic trip", url: "https://x.invalid/?token=1", amountCents: 18400 });
  assert.deepEqual(safe?.properties, { sample: true, role: "participant", utm_source: "splitwise", deviceClass: "mobile", $device_type: "Mobile" });
  assert.equal(safeProductEvent("poll_assist_failed", { outcome: "failed", questionCount: 3, mode: "revise", prompt: "secret" })?.properties.prompt, undefined);
  assert.equal(safeProductEvent("role_not_listed_event", {}), null, "unlisted events never leave");
  assert.equal(safeProductEvent("trip_tab_viewed", { role: "admin" })?.properties.role, undefined);
});

test("uncaught server error reports withhold message, path, query and headers", () => {
  const error = Object.assign(new Error("Synthetic Breckenridge SECRET-CONF-7"), { digest: "123abc" });
  const report = sanitizedServerError(error, { method: "post" }, { routePath: "/app/api/v1/commons/[slug]/expenses/route", routeType: "route" }, { VERCEL_GIT_COMMIT_SHA: "0123456789abcdef" });
  assert.deepEqual(report, { routePath: "/app/api/v1/commons/[slug]/expenses/route", routeType: "route", method: "POST", errorCategory: "Error", digest: "123abc", release: "0123456789ab" });
  const hostile = sanitizedServerError({ message: "x" }, { method: "BREW" }, { routePath: "/c/trip?token=SECRET", routeType: "weird" }, {});
  assert.deepEqual(hostile, { routePath: "unknown", routeType: "unknown", method: "OTHER", errorCategory: "UnknownError", digest: null, release: "local" });
});
