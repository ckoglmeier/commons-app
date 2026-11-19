import "server-only";
import { getGroupInvitationPreview, joinGroupInvitation, GroupInvitationUnavailableError, findOrClaimPersonForAuthIdentity } from "@commons/database";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CommonsAuthenticationRequiredError } from "./commons-access-errors";
import { commonsDatabaseUrl } from "./runtime-environment";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { authenticatedCommonsRepositoryOptions } from "./commons";
import { getSupabaseVerifiedAuthUserEmail } from "@/lib/supabase/admin";

export async function verifiedGroupInvitationIdentity() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user || !user.email_confirmed_at || !user.email) throw new CommonsAuthenticationRequiredError();
  return { authUserId: user.id, email: user.email, displayName: typeof user.user_metadata?.first_name === "string" ? user.user_metadata.first_name.trim() : undefined };
}
/** A link keeps working only while its creator still has a provider-verified account. */
async function creatorStillEligible(authUserId: string, _tripId: string) {
  return Boolean(await getSupabaseVerifiedAuthUserEmail(authUserId));
}
export async function groupInvitationManagementOptions(slug: string, mode: "read" | "write" = "write") {
  const url = commonsDatabaseUrl(); if (!url) throw new Error("Commons persistence is not configured.");
  // Existing explicit localhost fixture path; never runs on Vercel.
  if (!isSupabaseAuthConfigured()) return authenticatedCommonsRepositoryOptions();
  let identity;
  try { identity = await verifiedGroupInvitationIdentity(); }
  catch (error) { if (mode === "read" && error instanceof CommonsAuthenticationRequiredError) return null; throw error; }
  const actorPersonId = await findOrClaimPersonForAuthIdentity(identity, url);
  if (!actorPersonId) throw new CommonsAuthenticationRequiredError();
  return { databaseUrl: url, actorPersonId, creatorCheck: creatorStillEligible };
}
export async function publicGroupInvitationPreview(token: string) {
  const url = commonsDatabaseUrl(); if (!url) return null;
  return getGroupInvitationPreview(token, url, new Date(), isSupabaseAuthConfigured() ? creatorStillEligible : undefined);
}
export async function joinAuthenticatedGroupInvitation(token: string, input: unknown) {
  const url = commonsDatabaseUrl(), preview = await publicGroupInvitationPreview(token);
  if (!url || !preview) throw new GroupInvitationUnavailableError();
  const identity = await verifiedGroupInvitationIdentity();
  if (!identity.displayName) throw new GroupInvitationUnavailableError("Finish creating your account, then return to this invitation.");
  return joinGroupInvitation(token, identity, input, url, creatorStillEligible);
}
