import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("support page speaks for a self-hosted copy", () => {
  const page = read("app/support/page.tsx");
  assert.match(page, /this copy is run by \{runBy\}\. There’s no central support team\./);
  assert.match(page, /emailDeliveryAvailable\(\)/);
  assert.match(page, /\/sign-in\/\?next=%2Ftrips"/);
  assert.doesNotMatch(page, /Tell us|email support|handled by support|We confirm|intent=invited/i);
});

test("analytics choices show only when analytics are configured", () => {
  assert.match(read("app/support/page.tsx"), /process\.env\.NEXT_PUBLIC_POSTHOG_KEY \? <section id="analytics"/);
  const choices = read("components/analytics-choices.tsx");
  assert.match(choices, /This copy uses optional analytics/);
  assert.doesNotMatch(choices, /budget calculators/);
});

test("profile says used, not verified, when people sign in with a password", () => {
  assert.match(read("components/profile-contact-methods.tsx"), /passwordSignIn \? "Used for sign-in" : "Verified for sign-in"/);
  assert.match(read("app/profile/page.tsx"), /passwordSignIn=\{passwords\}/);
});
