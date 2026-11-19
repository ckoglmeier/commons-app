import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("backs up the coordinator branch without enabling a Vercel deployment", async () => {
  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  );

  // Leave all other branches on Vercel's existing deployment defaults.
  assert.deepEqual(config.git?.deploymentEnabled, {
    "codex/coordinator-inference-tracing": false,
    "codex/coordinator-plan-import": false,
    "codex/itinerary-feedback-release": false,
    "codex/itinerary-generation-timeout": false,
    "codex/composer-attachments-release": false,
    "codex/conversational-itinerary-document": false,
    "claude/trip-map-v0": false,
    "codex/oct23-conversation-durability": false,
    "claude/free-beta": false,
    "claude/beta-rework": false,
    "claude/beta-account-access": false,
    "claude/sms-overnight": false,
    "claude/sms-live-test": false,
    "claude/sms-funding": false,
    "claude/web-messages": false,
    "claude/web-messages-fixes": false,
    "claude/ci-parallel-tests": false,
  });
});

test("keeps production crons inside the configured apps/web Vercel root", async () => {
  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };

  assert.deepEqual(config.crons, [
    {
      path: "/api/internal/invitation-deliveries/",
      schedule: "0 9 * * *",
    },
    {
      path: "/api/internal/conversation-digests/",
      schedule: "0 16 * * *",
    },
    {
      path: "/api/internal/daily-analytics/",
      schedule: "0 14 * * *",
    },
    {
      path: "/api/internal/messaging/",
      schedule: "0 17 * * *",
    },
  ]);
});

test("bundles the city catalogs with both routes that read them at runtime", async () => {
  const config = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
  for (const route of ["/api/v1/location-timezones", "/api/v1/map-cities"]) {
    assert.match(config, new RegExp(`"${route}": \\["\\./lib/server/data/\\*"\\]`), `${route} must include lib/server/data`);
  }
});
