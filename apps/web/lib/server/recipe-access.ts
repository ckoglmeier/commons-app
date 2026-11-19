import "server-only";
import { resolveCommonsTripId } from "@commons/database";
import type { CommonsAuthIdentity } from "@/lib/supabase/server";
import { readVerifiedSearchIdentity } from "./coordinator-search-session";
import { commonsDatabaseUrl } from "./runtime-environment";
import { resolveTripCapabilities } from "./trip-capabilities";

type RecipeEnvironment = { COMMONS_RECIPES_ENABLED?: string; COMMONS_RECIPES_PILOT_EMAILS?: string; COMMONS_RECIPES_PILOT_TRIP_IDS?: string; [name: string]: unknown };
const list = (value: string | undefined) => new Set((value ?? "").split(",").map(entry => entry.trim().toLowerCase()).filter(Boolean));

/**
 * One server-side recipe policy for pages, routes and Coordinator entry points.
 * Recipes are on for every account unless the flag is "false". Then a pilot needs BOTH a
 * provider-verified account email and an allowed trip id; either list empty,
 * a local pilot actor, a typed address or a client flag grants nothing.
 * Organizer membership is still checked separately by every recipe command.
 */
export function recipeAccessAllowed(environment: RecipeEnvironment, identity: CommonsAuthIdentity | null, tripId: string | null) {
  if ((environment.COMMONS_RECIPES_ENABLED ?? "true").trim() !== "false") return true;
  const emails = list(environment.COMMONS_RECIPES_PILOT_EMAILS), trips = list(environment.COMMONS_RECIPES_PILOT_TRIP_IDS);
  const email = identity?.authUserId ? identity.email?.trim().toLowerCase() : undefined;
  return Boolean(emails.size && trips.size && email && tripId && emails.has(email) && trips.has(tripId.toLowerCase()));
}

export async function recipesAvailableFor(slug: string, environment: RecipeEnvironment = process.env) {
  // Free beta trips never get guided recipes; the recipe routes and pages refuse them too. An operator who wants a
  // recipes pilot on such a trip lists it in COMMONS_PILOT_TRIP_IDS (trip-capabilities.ts).
  try { if (!(await resolveTripCapabilities(slug, environment)).goals) return false; } catch { return false; }
  if ((environment.COMMONS_RECIPES_ENABLED ?? "true").trim() !== "false") return true;
  return recipesPilotAllows(slug, environment);
}

/** The scoped recipes pilot: a provider-verified listed email on a listed trip. */
async function recipesPilotAllows(slug: string, environment: RecipeEnvironment) {
  if (!environment.COMMONS_RECIPES_PILOT_EMAILS?.trim() || !environment.COMMONS_RECIPES_PILOT_TRIP_IDS?.trim()) return false;
  try {
    const [identity, tripId] = await Promise.all([readVerifiedSearchIdentity(), resolveCommonsTripId(slug, commonsDatabaseUrl() ?? undefined)]);
    return recipeAccessAllowed(environment, identity, tripId);
  } catch { return false; }
}
