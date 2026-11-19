import { tripKeys } from "@commons/database";
import { commonsDatabaseUrl } from "@/lib/server/runtime-environment";

/*
 * Rollout for the Commons-native lodging journey. Default off: an explicit switch AND an explicit trip allowlist, and never in production without a second
 * switch. Model resolution (./resolve.ts) is a separate default-off switch on top of this one. These are deployment controls only: they are not a pricing
 * or entitlement decision, and none has been made for this journey.
 * Turning native lodging off routes new lodging requests back to the ordinary coordinator; a proposal already prepared is still applied by the same review
 * command, and its outcome says the follow-up was not available.
 */
export function nativeLodgingListed(keys: { id: string; slug: string; actorPersonId?: string }, env: Record<string, string | undefined> = process.env): boolean {
  if (env.COMMONS_NATIVE_LODGING_ENABLED?.trim() !== "true") return false;
  if (env.VERCEL_ENV === "production" && env.COMMONS_NATIVE_LODGING_ALLOW_PRODUCTION?.trim() !== "true") return false;
  const people = (env.COMMONS_NATIVE_LODGING_PERSON_IDS ?? "").split(",").map(item => item.trim()).filter(Boolean);
  // Production tests require both an authenticated-account and trip allowlist.
  // This limits execution, not visibility of already shared trip artifacts.
  if ((people.length || env.VERCEL_ENV === "production") && (!keys.actorPersonId || !people.includes(keys.actorPersonId))) return false;
  const list = (env.COMMONS_NATIVE_LODGING_TRIPS ?? "").split(",").map(item => item.trim()).filter(Boolean);
  return list.includes(keys.id) || list.includes(keys.slug);
}

export async function nativeLodgingSelected(identifier: string, actorPersonId: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (env.COMMONS_NATIVE_LODGING_ENABLED?.trim() !== "true") return false;
  const keys = await tripKeys(identifier, { databaseUrl: commonsDatabaseUrl() ?? undefined });
  return keys ? nativeLodgingListed({ ...keys, actorPersonId }, env) : false;
}

/** The second, independent switch: one bounded structured model call for lodging-scoped requests the phrase rules do not resolve. */
export function lodgingModelResolveEnabled(env: Record<string, string | undefined> = process.env) {
  return env.COMMONS_NATIVE_LODGING_MODEL_RESOLVE?.trim() === "true";
}
