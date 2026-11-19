import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAuthConfig, isSupabaseAuthConfigured } from "./config";
import { getCommonsAuthCookieOptions } from "./session";
import { currentTurnPrincipal } from "@/lib/server/turn-principal";

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

export async function getCommonsAuthIdentity(): Promise<CommonsAuthIdentity | null> {
  if (!isSupabaseAuthConfigured()) return null;
  // Durable turn execution has no cookies: the identity verified at admission, with the email re-verified by the runner at claim (or none).
  const principal = currentTurnPrincipal();
  if (principal) return principal.authUserId ? { authUserId: principal.authUserId, ...(principal.verifiedEmail ? { email: principal.verifiedEmail } : {}) } : null;
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
