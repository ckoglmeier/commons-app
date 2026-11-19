import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export { DEV_SIGN_IN_COOKIE, devSignInAllowed, devSignInAllowedForHost, hostName, isLocalHost } from "./dev-sign-in-policy";

type Env = Record<string, string | undefined>;

function signingKey(env: Env) {
  const key = env.COMMONS_INVITATION_TOKEN_KEY?.trim();
  return key ? createHash("sha256").update(`commons-dev-sign-in:${key}`).digest() : null;
}

export type DevIdentity = { authUserId: string; email: string; displayName?: string };

/** A stable, UUID-shaped account id for an email, so signing in again finds the same person. */
export function devAuthUserId(email: string) {
  const hex = createHash("sha256").update(`commons-dev-user:${email.trim().toLowerCase()}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function devIdentityFor(email: string, displayName?: string): DevIdentity {
  const normalized = email.trim().toLowerCase();
  return { authUserId: devAuthUserId(normalized), email: normalized, ...(displayName?.trim() ? { displayName: displayName.trim().slice(0, 80) } : {}) };
}

export function encodeDevIdentity(identity: DevIdentity, env: Env = process.env) {
  const key = signingKey(env);
  if (!key) throw new Error("COMMONS_INVITATION_TOKEN_KEY is required for the local test sign-in.");
  const payload = Buffer.from(JSON.stringify(identity)).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function decodeDevIdentity(value: string | null | undefined, env: Env = process.env): DevIdentity | null {
  const key = signingKey(env);
  if (!key || !value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", key).update(payload).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<DevIdentity>;
    if (typeof parsed.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email)) return null;
    const identity = devIdentityFor(parsed.email, typeof parsed.displayName === "string" ? parsed.displayName : undefined);
    return parsed.authUserId === identity.authUserId ? identity : null;
  } catch {
    return null;
  }
}
