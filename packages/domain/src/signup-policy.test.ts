import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SIGNUP_MODE, emailDomain, normalizeAllowedDomains, parseSignupMode, signupDecision } from "./signup-policy";

const stranger = { email: "new@example.org", firstAccount: false, existingAccount: false, invited: false };

test("invited only is the default and refuses strangers", () => {
  assert.equal(DEFAULT_SIGNUP_MODE, "invited");
  assert.equal(parseSignupMode(undefined), "invited");
  assert.equal(parseSignupMode("everyone"), "invited");
  assert.deepEqual(signupDecision(stranger, { mode: "invited", allowedDomains: [] }), { allowed: false, reason: "invited_only" });
});

test("the first account, existing accounts and invited travelers are always allowed", () => {
  for (const mode of ["invited", "domains", "anyone"] as const) {
    const settings = { mode, allowedDomains: [] };
    assert.equal(signupDecision({ ...stranger, firstAccount: true }, settings).reason, "first_account");
    assert.equal(signupDecision({ ...stranger, existingAccount: true }, settings).reason, "existing_account");
    assert.equal(signupDecision({ ...stranger, invited: true }, settings).reason, "invited");
  }
});

test("listed domains allow only matching emails", () => {
  const settings = { mode: "domains" as const, allowedDomains: normalizeAllowedDomains("@Example.org, family.net\nnot a domain") };
  assert.deepEqual(settings.allowedDomains, ["example.org", "family.net"]);
  assert.equal(signupDecision(stranger, settings).allowed, true);
  assert.equal(signupDecision({ ...stranger, email: "Someone@FAMILY.net" }, settings).allowed, true);
  assert.deepEqual(signupDecision({ ...stranger, email: "a@sub.example.org" }, settings), { allowed: false, reason: "domain_not_listed" });
  assert.equal(emailDomain("no-at-sign"), "");
});

test("anyone with the link may create an account", () => {
  assert.deepEqual(signupDecision(stranger, { mode: "anyone", allowedDomains: [] }), { allowed: true, reason: "anyone" });
});
