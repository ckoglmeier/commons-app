import test from "node:test";
import assert from "node:assert/strict";
import { breachedSignals, DEFAULT_TRAFFIC_ALERTS, trafficAlertLevels } from "./traffic";
import { renderOperatorNotificationEmail } from "../email/operator-notification-email";

test("alert levels default sensibly and only valid overrides apply", () => {
  assert.deepEqual(trafficAlertLevels({}), DEFAULT_TRAFFIC_ALERTS);
  assert.equal(trafficAlertLevels({ COMMONS_TRAFFIC_ALERT_RESPONSES: "50" }).responses, 50);
  for (const bad of ["0", "-1", "many", ""]) assert.equal(trafficAlertLevels({ COMMONS_TRAFFIC_ALERT_FAILURES: bad }).failures, DEFAULT_TRAFFIC_ALERTS.failures);
});

test("a signal breaches at its level, not below it", () => {
  const levels = { failures: 2, responses: 5, polls: 5, trips: 5 };
  assert.deepEqual(breachedSignals({ failures: 1, responses: 4, polls: 0, trips: 0 }, levels), []);
  assert.deepEqual(breachedSignals({ failures: 2, responses: 5, polls: 0, trips: 0 }, levels), ["failures", "responses"]);
});

test("a traffic alert states counts and links to the operator page, with no trip details", () => {
  const mail = renderOperatorNotificationEmail({ kind: "traffic_alert", hour: "2026-11-06T17:00Z", signal: "failures", label: "server failures", count: 31, level: 25 }, "https://commons.example");
  assert.match(mail.subject, /server failures/);
  assert.match(mail.text, /31 server failures in the hour starting 2026-11-06T17:00Z\. The alert level is 25\./);
  assert.match(mail.html, /https:\/\/commons\.example\/admin\/beta\//);
});
