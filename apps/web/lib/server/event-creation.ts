import "server-only";
import { personForSignedInAccount } from "./account-person";
import { parseTripEntryContext } from "@/lib/trip-entry/context";

import {
  commitEventCreationDraft,
  createEventCreationDraft,
  getEventCreationDraft,
  listRecentReusableEvents,
  updateEventCreationDraft,
  updateEventCreationDraftPeople,
} from "@commons/database";
import {
  getLocalDevelopmentPilotActorId,
  isSignInConfigured,
} from "@/lib/supabase/config";
import { getCommonsAuthIdentity } from "@/lib/supabase/server";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
} from "./commons-access-errors";
import { commonsDatabaseUrl } from "./runtime-environment";

function databaseUrl() {
  return commonsDatabaseUrl();
}

async function creationOptions() {
  const url = databaseUrl();
  if (!url) throw new Error("Commons database persistence is not configured.");
  if (!isSignInConfigured()) {
    const actorPersonId = getLocalDevelopmentPilotActorId();
    if (!actorPersonId) throw new CommonsAuthenticationRequiredError();
    return { databaseUrl: url, actorPersonId };
  }
  const identity = await getCommonsAuthIdentity();
  if (!identity) throw new CommonsAuthenticationRequiredError();
  const actorPersonId = await personForSignedInAccount(identity, url);
  if (!actorPersonId) throw new CommonsMembershipRequiredError();
  return { databaseUrl: url, actorPersonId };
}

/** Any signed-in account may create a trip. */
export async function getEventCreationPageAccess() {
  if (!isSignInConfigured()) return { signedIn: Boolean(getLocalDevelopmentPilotActorId()) };
  return { signedIn: Boolean(await getCommonsAuthIdentity()) };
}

export async function loadRecentEventsForCreation() {
  const options = await creationOptions();
  return listRecentReusableEvents(options);
}

export async function createAuthenticatedEventDraft(input: unknown) {
  const options = await creationOptions();
  const raw = input && typeof input === "object" ? (input as { entryContext?: unknown }).entryContext : undefined;
  const entryContext = raw && typeof raw === "object" ? parseTripEntryContext(raw as Record<string, unknown>) : {};
  return createEventCreationDraft(input, { ...options, entryContext: Object.keys(entryContext).length ? entryContext : undefined });
}

export async function loadAuthenticatedEventDraft(draftId: string) {
  const options = await creationOptions();
  return getEventCreationDraft(draftId, options);
}

export async function updateAuthenticatedEventDraft(draftId: string, input: unknown) {
  const options = await creationOptions();
  return updateEventCreationDraft(draftId, input, options);
}

export async function updateAuthenticatedEventDraftPeople(draftId: string, input: unknown) {
  const options = await creationOptions();
  return updateEventCreationDraftPeople(draftId, input, options);
}

export async function commitAuthenticatedEventDraft(draftId: string, input: unknown) {
  const options = { ...await creationOptions(), newExperience: true };
  return commitEventCreationDraft(draftId, input, options);
}
