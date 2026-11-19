import assert from "node:assert/strict";
import test from "node:test";
import { decodeDevIdentity, devIdentityFor, devSignInAllowed, devSignInAllowedForHost, encodeDevIdentity, isLocalHost } from "./dev-sign-in";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const on = { COMMONS_DEV_SIGN_IN: "true", COMMONS_INVITATION_TOKEN_KEY: KEY };

test("the local test sign-in only works in development with the flag on and no hosted or Supabase settings", () => {
  assert.equal(devSignInAllowed(on, "development"), true);
  assert.equal(devSignInAllowed(on, "production"), false, "never in a production build");
  assert.equal(devSignInAllowed(on, "test"), false);
  assert.equal(devSignInAllowed(on, undefined), false);
  assert.equal(devSignInAllowed({ ...on, COMMONS_DEV_SIGN_IN: "1" }, "development"), false, "only the exact value turns it on");
  assert.equal(devSignInAllowed({ COMMONS_INVITATION_TOKEN_KEY: KEY }, "development"), false, "off unless asked for");
  assert.equal(devSignInAllowed({ ...on, VERCEL: "1" }, "development"), false);
  assert.equal(devSignInAllowed({ ...on, VERCEL_ENV: "preview" }, "development"), false);
  assert.equal(devSignInAllowed({ ...on, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" }, "development"), false, "real sign-in wins");
  assert.equal(devSignInAllowed({ COMMONS_DEV_SIGN_IN: "true" }, "development"), false, "needs a signing key");
});

test("the local test sign-in refuses requests that don't come from this computer", () => {
  for (const host of ["localhost:3000", "127.0.0.1:3100", "[::1]:3000", "LOCALHOST"]) assert.equal(isLocalHost(host), true, host);
  for (const host of ["commons.example.com", "localhost.example.com", "192.168.1.20:3000", "evil.localhost.attacker.test", "", null]) assert.equal(isLocalHost(host), false, String(host));
  assert.equal(devSignInAllowedForHost("localhost:3000", on, "development"), true);
  assert.equal(devSignInAllowedForHost("commons.example.com", on, "development"), false);
  assert.equal(devSignInAllowedForHost("localhost:3000", on, "production"), false);
});

test("a signed test identity round-trips and a forged or altered one is refused", () => {
  const identity = devIdentityFor(" Maya@Example.test ", "Maya");
  assert.equal(identity.email, "maya@example.test");
  assert.match(identity.authUserId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(devIdentityFor("maya@example.test").authUserId, identity.authUserId, "the same email is the same account");
  const cookie = encodeDevIdentity(identity, on);
  assert.deepEqual(decodeDevIdentity(cookie, on), identity);
  const [payload] = cookie.split(".");
  const forged = Buffer.from(JSON.stringify({ ...identity, email: "organizer@example.test" })).toString("base64url");
  assert.equal(decodeDevIdentity(`${forged}.${cookie.split(".")[1]}`, on), null);
  assert.equal(decodeDevIdentity(`${payload}.AAAA`, on), null);
  assert.equal(decodeDevIdentity(cookie, { ...on, COMMONS_INVITATION_TOKEN_KEY: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=" }), null);
  assert.equal(decodeDevIdentity(undefined, on), null);
});
