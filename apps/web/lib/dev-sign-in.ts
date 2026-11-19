import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/*
 * Local test sign-in, for trying Commons on your own computer with made-up people. It never works in a production build,
 * on Vercel, with Supabase configured, or for a request that doesn't come from this computer.
 *
 * Turn it on with COMMONS_DEV_SIGN_IN=true while running `npm run dev`. Real sign-in uses Supabase email links.
 */

export const DEV_SIGN_IN_COOKIE = "commons_dev_identity";

type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** The host name of a Host header value, without the port. */
export function hostName(host: string | null | undefined) {
  if (!host) return "";
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) return value.slice(0, value.indexOf("]") + 1);
  return value.split(":")[0] ?? "";
}

export function isLocalHost(host: string | null | undefined) {
  return LOCAL_HOSTS.has(hostName(host));
}

/**
 * Whether the local test sign-in may be used. `nodeEnv` defaults to the build-time NODE_ENV, which Next replaces with
 * "production" in production builds, so this returns false there whatever the environment says.
 */
export function devSignInAllowed(env: Env = process.env, nodeEnv: string | undefined = process.env.NODE_ENV) {
  if (nodeEnv !== "development") return false;
  if (env.COMMONS_DEV_SIGN_IN !== "true") return false;
  if (env.VERCEL || env.VERCEL_ENV) return false;
  if (env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return false;
  return Boolean(signingKey(env));
}

/** Allowed for this request: the setting is on and the request's Host is this computer. */
export function devSignInAllowedForHost(host: string | null | undefined, env: Env = process.env, nodeEnv: string | undefined = process.env.NODE_ENV) {
  return devSignInAllowed(env, nodeEnv) && isLocalHost(host);
}

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
