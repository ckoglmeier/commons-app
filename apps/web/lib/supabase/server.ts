import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { DEV_SIGN_IN_COOKIE, decodeDevIdentity, devSignInAllowedForHost, type DevIdentity } from "@/lib/dev-sign-in";
import { getSupabaseAuthConfig, isSupabaseAuthConfigured } from "./config";
import { getCommonsAuthCookieOptions } from "./session";

export async function createSupabaseServerClient() {
  const { url, publishableKey } = getSupabaseAuthConfig();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookieOptions: getCommonsAuthCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // A Server Component cannot write cookies. The request proxy refreshes
          // sessions before protected components render.
        }
      },
    },
  });
}

export type CommonsAuthIdentity = {
  authUserId: string;
  email?: string;
  phone?: string;
  displayName?: string;
};

/** The local test sign-in's identity for this request, or null. Never available in a production build or away from localhost. */
export async function getDevSignInIdentity(): Promise<DevIdentity | null> {
  if (process.env.NODE_ENV !== "development") return null;
  const requestHeaders = await headers();
  if (!devSignInAllowedForHost(requestHeaders.get("host"))) return null;
  return decodeDevIdentity((await cookies()).get(DEV_SIGN_IN_COOKIE)?.value);
}

export async function getCommonsAuthIdentity(): Promise<CommonsAuthIdentity | null> {
  if (!isSupabaseAuthConfigured()) return getDevSignInIdentity();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return {
    authUserId: data.claims.sub,
    email:
      typeof data.claims.email === "string" ? data.claims.email : undefined,
    phone:
      typeof data.claims.phone === "string" ? data.claims.phone : undefined,
    displayName:
      typeof data.claims.user_metadata === "object" &&
      data.claims.user_metadata !== null &&
      "first_name" in data.claims.user_metadata &&
      typeof data.claims.user_metadata.first_name === "string"
        ? data.claims.user_metadata.first_name
        : undefined,
  };
}

/**
 * The signed-in account with its email only when confirmed. For Supabase this asks the auth server (not just the cookie). For the local
 * test sign-in the made-up email counts as confirmed, since that path only exists on a development machine.
 */
export async function getVerifiedAuthUser(): Promise<{ authUserId: string; email: string | null; displayName?: string } | null> {
  if (!isSupabaseAuthConfigured()) {
    const dev = await getDevSignInIdentity();
    return dev ? { authUserId: dev.authUserId, email: dev.email, ...(dev.displayName ? { displayName: dev.displayName } : {}) } : null;
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const firstName = data.user.user_metadata?.first_name;
  return { authUserId: data.user.id, email: data.user.email_confirmed_at && data.user.email ? data.user.email : null, ...(typeof firstName === "string" && firstName.trim() ? { displayName: firstName.trim() } : {}) };
}
