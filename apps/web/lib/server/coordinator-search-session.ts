import "server-only";
import { createSupabaseServerClient, getCommonsAuthIdentity, type CommonsAuthIdentity } from "@/lib/supabase/server";
import { currentTurnPrincipal } from "./turn-principal";

/** Revalidate email ownership with the provider; profile copy and pilot actors grant no access. */
export function verifiedSearchAccount(identity: CommonsAuthIdentity | null, user: {id:string;email?:string;email_confirmed_at?:string|null}|null, error: unknown): CommonsAuthIdentity | null {
  return !error && identity && user?.email_confirmed_at && user.id === identity.authUserId && user.email ? {authUserId:user.id,email:user.email} : null;
}
export async function readVerifiedSearchIdentity(): Promise<CommonsAuthIdentity | null> {
  // Durable turn execution: only an email the runner re-verified with the provider at claim.
  const principal = currentTurnPrincipal();
  if (principal) return principal.authUserId && principal.verifiedEmail ? { authUserId: principal.authUserId, email: principal.verifiedEmail } : null;
  try {
  const identity = await getCommonsAuthIdentity();
  if (!identity) return null;
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  const user = data?.user;
  return verifiedSearchAccount(identity,user ?? null,error);
  } catch { return null; }
}
