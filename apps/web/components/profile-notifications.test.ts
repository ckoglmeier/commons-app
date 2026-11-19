import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the daily email preference explicit and separate from identity email", async () => {
  const [component, page] = await Promise.all([
    readFile(new URL("./profile-notifications.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/profile/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(component, /Daily summary/);
  assert.match(component, /Email me a daily summary/);
  assert.match(component, /One email with what changed\. No email on quiet days/);
  assert.match(component, /Doesn’t change invitation, sign-in, or poll emails/);
  assert.match(component, /Choose your trips/);
  assert.match(component, /new updates only/);
  assert.match(component, /Your event choices are saved/);
  assert.match(component, /role="switch"/);
  assert.match(component, /dailyDigestEnabled/);
  assert.match(page, /initialDailyDigestEnabled=\{profile\.dailyDigestEnabled\}/);
});

test("gives the notification control a mobile-sized target and accessible states", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /profile-notification-row input[^}]*height:\s*var\(--cm-touch-target\)/s);
  assert.match(css, /profile-notification-row input:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
