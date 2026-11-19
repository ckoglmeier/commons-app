import { recordBetaAttribution } from "./beta-completion";
import "server-only";
import { getGroupInvitationPreview, joinGroupInvitation, GroupInvitationUnavailableError, findOrClaimPersonForAuthIdentity, resolveCommonsTripId } from "@commons/database";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CommonsAuthenticationRequiredError } from "./commons-access-errors";
import { commonsDatabaseUrl } from "./runtime-environment";
import { recipeAccessAllowed } from "./recipe-access";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { authenticatedCommonsRepositoryOptions } from "./commons";
import { getSupabaseVerifiedAuthUserEmail } from "@/lib/supabase/admin";

type Environment = { [key: string]: unknown };
export function groupInvitationTripEnabled(tripId: string, environment: Environment = process.env) {
  return environment.COMMONS_GROUP_INVITATIONS_ENABLED === "true" || environment.COMMONS_GROUP_INVITATIONS_PILOT_ENABLED === "true" &&
    String(environment.COMMONS_RECIPES_PILOT_TRIP_IDS ?? "").split(",").map(id => id.trim().toLowerCase()).includes(tripId.toLowerCase());
}
export async function verifiedGroupInvitationIdentity() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user || !user.email_confirmed_at || !user.email) throw new CommonsAuthenticationRequiredError();
  return { authUserId: user.id, email: user.email, displayName: typeof user.user_metadata?.first_name === "string" ? user.user_metadata.first_name.trim() : undefined };
}
/** Gate and actor resolution use one fresh provider identity, including revocation. */
async function creatorStillEligible(authUserId: string, tripId: string) {
  if (!groupInvitationTripEnabled(tripId)) return false;
  const email = await getSupabaseVerifiedAuthUserEmail(authUserId);
  if (!email) return false;
  return process.env.COMMONS_GROUP_INVITATIONS_ENABLED === "true" || recipeAccessAllowed({ ...process.env, COMMONS_RECIPES_ENABLED: "false" }, { authUserId, email }, tripId);
}
export async function groupInvitationManagementOptions(slug: string, mode: "read" | "write" = "write") {
  if (process.env.COMMONS_GROUP_INVITATIONS_ENABLED !== "true" && process.env.COMMONS_GROUP_INVITATIONS_PILOT_ENABLED !== "true") return null;
  const url = commonsDatabaseUrl(); if (!url) throw new Error("Commons persistence is not configured.");
  if (!isSupabaseAuthConfigured()) {
    // Existing explicit localhost fixture path; never grants pilot access or runs on Vercel.
    return process.env.COMMONS_GROUP_INVITATIONS_ENABLED === "true" ? authenticatedCommonsRepositoryOptions() : null;
  }
  let identity;
  try { identity = await verifiedGroupInvitationIdentity(); }
  catch (error) { if (mode === "read" && error instanceof CommonsAuthenticationRequiredError) return null; throw error; }
  // Do not look up a trip or show invitation failures to an out-of-pilot account.
  if (process.env.COMMONS_GROUP_INVITATIONS_ENABLED !== "true" && !String(process.env.COMMONS_RECIPES_PILOT_EMAILS ?? "").split(",").some(email => email.trim().toLowerCase() === identity.email.trim().toLowerCase())) return null;
  const tripId = await resolveCommonsTripId(slug, url);
  if (process.env.COMMONS_GROUP_INVITATIONS_ENABLED !== "true" && !recipeAccessAllowed({ ...process.env, COMMONS_RECIPES_ENABLED: "false" }, identity, tripId)) return null;
  const actorPersonId = await findOrClaimPersonForAuthIdentity(identity, url);
  if (!actorPersonId) throw new CommonsAuthenticationRequiredError();
  return { databaseUrl: url, actorPersonId, creatorCheck: creatorStillEligible };
}
export async function publicGroupInvitationPreview(token: string) {
  if (process.env.COMMONS_GROUP_INVITATIONS_ENABLED !== "true" && process.env.COMMONS_GROUP_INVITATIONS_PILOT_ENABLED !== "true") return null;
  const url = commonsDatabaseUrl(); if (!url) return null;
  const preview = await getGroupInvitationPreview(token, url, new Date(), isSupabaseAuthConfigured() ? creatorStillEligible : undefined);
  return preview && groupInvitationTripEnabled(preview.tripId) ? preview : null;
}
export async function joinAuthenticatedGroupInvitation(token: string, input: unknown) {
  const url = commonsDatabaseUrl(), preview = await publicGroupInvitationPreview(token);
  if (!url || !preview) throw new GroupInvitationUnavailableError();
  const identity = await verifiedGroupInvitationIdentity();
  if (!identity.displayName) throw new GroupInvitationUnavailableError("Finish creating your account, then return to this invitation.");
  const joined = await joinGroupInvitation(token, identity, input, url, creatorStillEligible);
  await recordBetaAttribution("traveler_participation", { entryKind: "unknown" }, preview.tripId);
  return joined;
}
