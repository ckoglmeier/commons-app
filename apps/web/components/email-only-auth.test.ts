import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production authentication stays email-only while SMS delivery is unavailable", async () => {
  const [form, page, profile, contactRoute] = await Promise.all([
    readFile(new URL("../app/sign-in/sign-in-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/sign-in/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("./profile-contact-methods.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/profile/contact/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(form, /requestSignInLink/);
  assert.match(form, /Send sign-in link/);
  assert.doesNotMatch(form, /type="tel"|requestPhoneCode|verifyPhoneCode|Use text message/);
  assert.match(page, /Use your email/);
  assert.doesNotMatch(page, /mobile number|one-time code|promotional or conversational texts/);
  assert.doesNotMatch(profile, /Mobile|type="tel"|verification code/i);
  assert.match(contactRoute, /Text-message verification is not available yet\. Use email to sign in\./);
  assert.match(contactRoute, /status: 503/);
});
