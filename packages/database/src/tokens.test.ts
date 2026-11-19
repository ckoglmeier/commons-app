import assert from "node:assert/strict";
import test from "node:test";
import {
  expiresAfterDays,
  hashNormalizedEmail,
  hashNormalizedPhone,
  hashOpaqueToken,
  isTokenExpired,
  mintRecoverableOpaqueToken,
  normalizePhone,
  protectOpaqueToken,
  revealLegacyOrProtectedOpaqueToken,
  revealOpaqueToken,
  revokedOpaqueTokenHash,
} from "./tokens";

test("opaque token hashes preserve case", () => {
  assert.notEqual(hashOpaqueToken("AbC_123"), hashOpaqueToken("abc_123"));
  assert.notEqual(hashOpaqueToken(" AbC_123 "), hashOpaqueToken("AbC_123"));
});

test("email hashes normalize case and surrounding whitespace", () => {
  assert.equal(
    hashNormalizedEmail(" Traveler@Example.COM "),
    hashNormalizedEmail("traveler@example.com"),
  );
});

test("phone hashes normalize E.164 formatting", () => {
  assert.equal(normalizePhone("+1 (415) 555-0142"), "+14155550142");
  assert.equal(hashNormalizedPhone("+1 513 884 4929"), hashNormalizedPhone("+14155550142"));
  assert.throws(() => normalizePhone("4155550142"), /E.164/);
});

test("recoverable opaque invitation tokens share generation, hashing, and protection", () => {
  const key = Buffer.alloc(32, 7);
  const value = mintRecoverableOpaqueToken(key);

  assert.equal(value.tokenHash, hashOpaqueToken(value.token));
  assert.notEqual(value.protectedToken, value.token);
  assert.equal(revealOpaqueToken(value.protectedToken, key), value.token);
});

test("time-limited credentials can still use explicit expiry checks", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const expiresAt = expiresAfterDays(3, now);
  assert.equal(expiresAt.toISOString(), "2026-09-04T12:00:00.000Z");
  assert.equal(isTokenExpired(expiresAt, now), false);
  assert.equal(isTokenExpired(expiresAt, expiresAt), true);
});

test("protected tokens fail closed when their envelope is changed", () => {
  const key = Buffer.alloc(32, 3);
  const protectedValue = protectOpaqueToken("opaque-token", key);
  assert.throws(() => revealOpaqueToken(`${protectedValue}changed`, key));
  assert.throws(() => revealOpaqueToken("not-an-envelope", key));
});

test("legacy poll token values remain readable while all new values are encrypted", () => {
  const key = Buffer.alloc(32, 9);
  assert.equal(revealLegacyOrProtectedOpaqueToken("legacy-token", key), "legacy-token");
  const protectedValue = protectOpaqueToken("new-token", key);
  assert.equal(revealLegacyOrProtectedOpaqueToken(protectedValue, key), "new-token");
});

test("revocation hashes cannot be used to recover or predict a private token", () => {
  assert.notEqual(revokedOpaqueTokenHash(), revokedOpaqueTokenHash());
});
