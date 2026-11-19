import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sealInvitationEmailProof, readInvitationEmailProof, INVITATION_SIGN_IN_LIFETIME_MS } from "@commons/database";
import { invitationReturnPath, maskedInvitationEmail, redeemInvitationEmail } from "./invitation-entry-flow";

process.env.COMMONS_INVITATION_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
const token = "SyntheticInvitationTokenCaseSensitive";
const inputProof = { token, tokenVersion: 2, email: "guest@example.test", authUserId: "guest-id", tokenHash: "provider-secret", type: "magiclink" as const };
const context = { invitationId: "invite-id", commonsId: "event-id", tokenVersion: 2, recipientEmail: "guest@example.test", status: "pending" as const, acceptedAuthUserId: null as string | null };
function fixture() {
  let verifies = 0, sessions = 0, reads = 0;
  const deps = {
    context: async () => { reads++; return context as typeof context | null; },
    currentAccount: async () => null as { authUserId: string } | null,
    verify: async () => { verifies++; return { authUserId: "guest-id", email: "guest@example.test", metadata: { first_name: "Guest" }, access_token: "synthetic-access", refresh_token: "synthetic-refresh" }; },
    establishSession: async () => { sessions++; },
  };
  return { deps, input: { token, entry: sealInvitationEmailProof(inputProof), expectedCurrentAccountId: "", poll: "abcdef123456" }, counts: () => ({ verifies, sessions, reads }) };
}

test("email proof is encrypted, bounded, purpose- and invitation-bound; copied invitation is not proof", () => {
  const entry = sealInvitationEmailProof(inputProof);
  assert.doesNotMatch(entry, /provider-secret|guest@example/);
  assert.equal(readInvitationEmailProof(token, token), null);
  assert.equal(readInvitationEmailProof(entry, token.toLowerCase()), null);
  assert.equal(readInvitationEmailProof(entry.slice(0, -10) + "tampered", token), null);
  assert.equal(readInvitationEmailProof(entry, token, Date.now() + INVITATION_SIGN_IN_LIFETIME_MS), null);
  assert.equal(readInvitationEmailProof("x".repeat(5000), token), null);
  assert.equal(readInvitationEmailProof(entry, token)?.authUserId, "guest-id");
});
test("fresh email authenticates once and preserves event/poll without claiming membership", async () => {
  const f = fixture();
  assert.deepEqual(await redeemInvitationEmail(f.input, f.deps), { destination: invitationReturnPath(token, "abcdef123456") });
  assert.deepEqual(f.counts(), { verifies: 1, sessions: 1, reads: 2 });
});
test("new account goes through first name with the same invitation return", async () => {
  const f = fixture(), verify = f.deps.verify;
  f.deps.verify = async () => ({ ...await verify(), metadata: {} as { first_name: string } });
  const result = await redeemInvitationEmail(f.input, f.deps);
  assert.match(result.destination!, /^\/account\/create\?/);
  assert.equal(new URL(result.destination!, "http://localhost").searchParams.get("next"), invitationReturnPath(token, "abcdef123456"));
});
test("expired or consumed provider proof establishes no session and retains recovery", async () => {
  const f = fixture();
  assert.deepEqual(await redeemInvitationEmail(f.input, { ...f.deps, verify: async () => null }), { error: "expired" });
  assert.equal(f.counts().sessions, 0);
});
test("existing matching account bypasses provider verification", async () => {
  const f = fixture();
  f.deps.currentAccount = async () => ({ authUserId: "guest-id" });
  assert.ok((await redeemInvitationEmail({ ...f.input, expectedCurrentAccountId: "guest-id" }, f.deps)).destination);
  assert.equal(f.counts().verifies, 0);
  assert.equal(f.counts().sessions, 0);
});
test("account changes fail closed, while explicit switch can establish only the proved account", async () => {
  const f = fixture(); f.deps.currentAccount = async () => ({ authUserId: "other-id" });
  assert.deepEqual(await redeemInvitationEmail(f.input, f.deps), { error: "account_changed" });
  assert.equal(f.counts().verifies, 0);
  assert.ok((await redeemInvitationEmail({ ...f.input, expectedCurrentAccountId: "other-id" }, f.deps)).destination);
});
test("reassignment, revocation during verification, wrong provider identity and accepted-other-account fail closed", async () => {
  for (const changed of [null, { ...context, tokenVersion: 3 }, { ...context, recipientEmail: "changed@example.test" }, { ...context, acceptedAuthUserId: "different-id" }]) {
    const f = fixture(); let read = 0;
    f.deps.context = async () => ++read === 1 ? context : changed;
    assert.deepEqual(await redeemInvitationEmail(f.input, f.deps), { error: "expired" });
    assert.equal(f.counts().sessions, 0);
  }
  const f = fixture(), verify = f.deps.verify;
  f.deps.verify = async () => ({ ...await verify(), authUserId: "attacker-id" });
  assert.deepEqual(await redeemInvitationEmail(f.input, f.deps), { error: "expired" });
  assert.equal(f.counts().sessions, 0);
});
test("return paths cannot escape invitation context; recipient display is masked", () => {
  assert.equal(invitationReturnPath(token, "https://evil.test"), `/join/${token}/`);
  assert.equal(maskedInvitationEmail("guest@example.test"), "g•••@example.test");
});
test("landing is read-only; entry does not load analytics and has non-referring headers", () => {
  const page = readFileSync(new URL("../app/join/[token]/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /verifyOtp|setSession|claimAuthenticatedInvitation/);
  const form = readFileSync(new URL("../app/join/[token]/invitation-entry-form.tsx", import.meta.url), "utf8");
  assert.match(form, /Use a different email/);
  assert.doesNotMatch(form, /name="email"/);
  assert.match(readFileSync(new URL("../components/product-analytics.tsx", import.meta.url), "utf8"), /sensitiveAnalyticsPath\(pathname\)/);
  assert.match(readFileSync(new URL("./analytics-invitation-privacy.ts", import.meta.url), "utf8"), /join/);
  assert.match(readFileSync(new URL("../next.config.ts", import.meta.url), "utf8"), /value: "no-referrer"/);
  assert.match(readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"), /\.invite-arrival__redeem \.invitation-entry-form \.auth-form button \{ min-height: 3\.5rem; font-size: \.9375rem;/);
});
