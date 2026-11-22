import "server-only";
import { personForSignedInAccount } from "./account-person";

import {
  getManagedTravelerProfile,
  getTravelerProfile,
  updateManagedTravelerProfile,
  updateTravelerProfile,
} from "@commons/database";
import { TravelerProfileSchema, UpdateTravelerProfileRequestSchema } from "@commons/contracts";
import { getCommonsAuthIdentity } from "@/lib/supabase/server";
import { commonsDatabaseUrl } from "./runtime-environment";

async function profileContext() {
  const identity = await getCommonsAuthIdentity();
  if (!identity) throw new Error("Sign in to view your travel profile.");
  const databaseUrl = commonsDatabaseUrl();
  if (!databaseUrl) throw new Error("Traveler profiles are not configured.");
  const personId = await personForSignedInAccount(identity, databaseUrl);
  if (!personId) throw new Error("Confirm your name before creating a travel profile.");
  return { identity, databaseUrl, personId };
}

export async function loadAuthenticatedTravelerProfile() {
  const context = await profileContext();
  const profile = await getTravelerProfile(context.personId, context.databaseUrl);
  if (!profile) throw new Error("Traveler profile not found.");
  return { ...TravelerProfileSchema.parse(profile), email: context.identity.email ?? null, phone: context.identity.phone ?? null };
}

export async function updateAuthenticatedTravelerProfile(input: unknown) {
  const context = await profileContext();
  return TravelerProfileSchema.parse(await updateTravelerProfile(
    context.personId,
    UpdateTravelerProfileRequestSchema.parse(input),
    context.databaseUrl,
  ));
}

export async function loadAuthenticatedManagedTravelerProfile(slug: string, personId: string) {
  const context = await profileContext();
  const profile = await getManagedTravelerProfile(slug, personId, context.personId, context.databaseUrl);
  if (!profile) throw new Error("Traveler profile not found.");
  return TravelerProfileSchema.parse(profile);
}

export async function updateAuthenticatedManagedTravelerProfile(slug: string, personId: string, input: unknown) {
  const context = await profileContext();
  return TravelerProfileSchema.parse(await updateManagedTravelerProfile(
    slug,
    personId,
    context.personId,
    UpdateTravelerProfileRequestSchema.parse(input),
    context.databaseUrl,
  ));
}
