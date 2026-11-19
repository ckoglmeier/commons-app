import "server-only";
import type { CommonsAuthIdentity } from "@/lib/supabase/server";
import { readCommonsRuntimeEnvironment } from "./runtime-environment";
import { readVerifiedSearchIdentity } from "./coordinator-search-session";

// Temporary owner-only rollout. A local pilot actor is not a signed-in email.
export const COORDINATOR_SEARCH_OWNER_EMAIL = "organizer@example.com";
export function searchIdentityAllowed(identity: CommonsAuthIdentity | null, ownerEmail = COORDINATOR_SEARCH_OWNER_EMAIL) {
  const allowed = ownerEmail.trim().toLowerCase();
  return Boolean(allowed && identity?.authUserId && identity.email?.trim().toLowerCase() === allowed);
}
export function betaSearchIdentityAllowed(identity: CommonsAuthIdentity | null, enabled: boolean) {
  return enabled ? Boolean(identity?.authUserId && identity.email?.trim()) : searchIdentityAllowed(identity);
}
export async function canUseCoordinatorSearch() {
  return betaSearchIdentityAllowed(await readVerifiedSearchIdentity(),readCommonsRuntimeEnvironment().COMMONS_RESEARCH_BETA_ENABLED === "true");
}

/** The synchronous beta does not widen the separately operated legacy research worker. */
export async function canUseCoordinatorBackgroundResearch() {
  return searchIdentityAllowed(await readVerifiedSearchIdentity());
}
