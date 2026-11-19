import { cookies, headers } from "next/headers";
import { DEV_SIGN_IN_COOKIE, devIdentityFor, devSignInAllowedForHost, encodeDevIdentity, type DevIdentity } from "@/lib/dev-sign-in";

/** Whether this request may use the local test sign-in. False in production builds (NODE_ENV is inlined) and for any other host. */
export async function devSignInAvailable() {
  if (process.env.NODE_ENV !== "development") return false;
  return devSignInAllowedForHost((await headers()).get("host"));
}

/** Signs this browser in as a made-up person. Only call after devSignInAvailable() is true. */
export async function startDevSession(email: string, displayName?: string): Promise<DevIdentity> {
  if (!(await devSignInAvailable())) throw new Error("The local test sign-in isn't available here.");
  const identity = devIdentityFor(email, displayName);
  (await cookies()).set(DEV_SIGN_IN_COOKIE, encodeDevIdentity(identity), { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 60 * 60 * 24 * 30 });
  return identity;
}

export async function endDevSession() {
  (await cookies()).delete(DEV_SIGN_IN_COOKIE);
}
