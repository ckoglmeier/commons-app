/*
 * Local test sign-in, for trying Commons on your own computer with made-up people. It never works in a production build,
 * on Vercel, with Supabase configured, or for a request that doesn't come from this computer. No Node-only imports here:
 * this guard is also read by code that ships to the browser. The signed cookie lives in dev-sign-in.ts.
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
  return Boolean(env.COMMONS_INVITATION_TOKEN_KEY?.trim());
}

/** Allowed for this request: the setting is on and the request's Host is this computer. */
export function devSignInAllowedForHost(host: string | null | undefined, env: Env = process.env, nodeEnv: string | undefined = process.env.NODE_ENV) {
  return devSignInAllowed(env, nodeEnv) && isLocalHost(host);
}

