import assert from "node:assert/strict";
import test from "node:test";
import { dailyAnalyticsWindow } from "./daily-analytics-repository";

test("daily analytics reports the previous Denver calendar day", () => {
  const window = dailyAnalyticsWindow(new Date("2026-09-18T14:00:00.000Z"));
  assert.equal(window.periodKey, "2026-09-17");
  assert.equal(window.startsAt.toISOString(), "2026-09-17T06:00:00.000Z");
  assert.equal(window.endsAt.toISOString(), "2026-09-18T06:00:00.000Z");
});

test("daily analytics observes Denver daylight-saving boundaries", () => {
  const window = dailyAnalyticsWindow(new Date("2026-03-09T14:00:00.000Z"));
  assert.equal(window.periodKey, "2026-03-08");
  assert.equal(window.startsAt.toISOString(), "2026-03-08T07:00:00.000Z");
  assert.equal(window.endsAt.toISOString(), "2026-03-09T06:00:00.000Z");
});
