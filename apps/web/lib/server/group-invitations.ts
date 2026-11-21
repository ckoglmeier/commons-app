import "server-only";
import { getGroupInvitationPreview, joinGroupInvitation, GroupInvitationUnavailableError, findOrClaimPersonForAuthIdentity } from "@commons/database";
import { getVerifiedAuthUser } from "@/lib/supabase/server";
import { CommonsAuthenticationRequiredError } from "./commons-access-errors";
import { commonsDatabaseUrl } from "./runtime-environment";
import { isSignInConfigured, isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { authenticatedCommonsRepositoryOptions } from "./commons";
import { getSupabaseVerifiedAuthUserEmail } from "@/lib/supabase/admin";

export async function verifiedGroupInvitationIdentity() {
  const user = await getVerifiedAuthUser();
  if (!user?.email) throw new CommonsAuthenticationRequiredError();
  // Password sign-in: the address proves nothing, so the database never claims an invited person by it.
  return { authUserId: user.authUserId, email: user.email, displayName: user.displayName, emailProvesIdentity: user.emailProvesIdentity };
}
/** A link keeps working only while its creator still has a provider-verified account. */
async function creatorStillEligible(authUserId: string, _tripId: string) {
  return Boolean(await getSupabaseVerifiedAuthUserEmail(authUserId));
}
/**
 * The provider check, when there is a provider to ask. The local test sign-in has no Supabase, so asking would always fail and
 * every link would read as disabled; the repository still requires the creator's live organizer membership.
 */
function creatorCheck() {
  return isSupabaseAuthConfigured() ? creatorStillEligible : undefined;
}
export async function groupInvitationManagementOptions(slug: string, mode: "read" | "write" = "write") {
  const url = commonsDatabaseUrl(); if (!url) throw new Error("Commons persistence is not configured.");
  // The fixed local-development actor (tests); never runs on Vercel. The local test sign-in uses the verified path below.
  if (!isSignInConfigured()) return authenticatedCommonsRepositoryOptions();
  let identity;
  try { identity = await verifiedGroupInvitationIdentity(); }
  catch (error) { if (mode === "read" && error instanceof CommonsAuthenticationRequiredError) return null; throw error; }
  const actorPersonId = await findOrClaimPersonForAuthIdentity(identity, url);
  if (!actorPersonId) throw new CommonsAuthenticationRequiredError();
  return { databaseUrl: url, actorPersonId, creatorCheck: creatorCheck() };
}
export async function publicGroupInvitationPreview(token: string) {
  const url = commonsDatabaseUrl(); if (!url) return null;
  return getGroupInvitationPreview(token, url, new Date(), creatorCheck());
}
export async function joinAuthenticatedGroupInvitation(token: string, input: unknown) {
  const url = commonsDatabaseUrl(), preview = await publicGroupInvitationPreview(token);
  if (!url || !preview) throw new GroupInvitationUnavailableError();
  const identity = await verifiedGroupInvitationIdentity();
  if (!identity.displayName) throw new GroupInvitationUnavailableError("Finish creating your account, then return to this invitation.");
  return joinGroupInvitation(token, identity, input, url, creatorCheck());
}
