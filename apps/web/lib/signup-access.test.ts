import assert from "node:assert/strict";
import test from "node:test";
import { decideSignup, type SignupLookups } from "./signup-access";

const signupAllowedFor = (email: string, next: string, look: SignupLookups, options: { emailVerified?: boolean } = {}) => decideSignup(look, email, next, options.emailVerified ?? true);

const lookups = (over: Partial<Record<"noAdmin" | "hasAccount" | "hasPendingInvitation" | "invitationLinkValid", boolean>> = {}) => ({
  noAdmin: async () => over.noAdmin ?? false,
  hasAccount: async () => over.hasAccount ?? false,
  hasPendingInvitation: async () => over.hasPendingInvitation ?? false,
  invitationLinkValid: async () => over.invitationLinkValid ?? false,
  settings: async () => ({ signupMode: "invited", allowedDomains: [] }),
});

test("with email sign-in, an invitation sent to the address lets a new person in", async () => {
  assert.equal((await signupAllowedFor("sam@example.com", "/", lookups({ hasPendingInvitation: true }))).allowed, true);
});

test("with password sign-in, an invitation to the address alone is not enough, since nobody proved they own it", async () => {
  const decision = await signupAllowedFor("sam@example.com", "/", lookups({ hasPendingInvitation: true }), { emailVerified: false });
  assert.equal(decision.allowed, false);
});

test("with password sign-in, holding a valid invite link lets a new person in", async () => {
  const decision = await signupAllowedFor("sam@example.com", "/join/abc", lookups({ invitationLinkValid: true }), { emailVerified: false });
  assert.equal(decision.allowed, true);
});

test("with password sign-in, the first account and existing accounts still work", async () => {
  assert.equal((await signupAllowedFor("ck@example.com", "/", lookups({ noAdmin: true }), { emailVerified: false })).allowed, true);
  assert.equal((await signupAllowedFor("sam@example.com", "/", lookups({ hasAccount: true }), { emailVerified: false })).allowed, true);
});
