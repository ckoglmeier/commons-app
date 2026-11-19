import { marketingOnlyEnabled } from '../marketing/route-mode';
import "server-only";
import { closedBetaRequired, eventCreationDecision, hasBootstrapEventCreationAccess } from "./event-creation-policy";
import { accountHasPilotCapabilities, coordinatorRetired, publicFreeBetaEnabled, resolveTripCapabilities } from "./trip-capabilities";
import { scheduleOperatorNotification } from "./operator-notifications";
import { betaActivationEnabled } from "@/lib/trip-activation/provider";
import { betaReworkEnabled } from "@/lib/beta/flags";
import { parseTripEntryContext } from "@/lib/trip-entry/context";

import {
  changeSetupCoordinator, finishSetupCoordinator,
  commitEventCreationDraft,
  claimBetaOrganizerInvite,
  createEventCreationDraft,
  findOrClaimPersonForAuthIdentity,
  getEventCreationAccess,
  getEventCreationDraft,
  tripsCreatedSince,
  listRecentReusableEvents,
  requestEventCreationAccess,
  updateEventCreationDraft,
  updateEventCreationDraftPeople,
} from "@commons/database";
import {
  getLocalDevelopmentPilotActorId,
  isSupabaseAuthConfigured,
} from "@/lib/supabase/config";
import { getCommonsAuthIdentity } from "@/lib/supabase/server";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
} from "./commons-access-errors";
import { commonsDatabaseUrl, readCommonsRuntimeEnvironment } from "./runtime-environment";
import { loadCommonsSnapshot } from "./commons";

export class EventCreationAccessRequiredError extends Error {
  constructor() {
    super("New event access is limited during the pilot.");
    this.name = "EventCreationAccessRequiredError";
  }
}

function databaseUrl() {
  return commonsDatabaseUrl();
}

async function accessForIdentity(identity: { authUserId: string; email?: string; displayName?: string }) {
  if (!closedBetaRequired() && !marketingOnlyEnabled() && hasBootstrapEventCreationAccess(readCommonsRuntimeEnvironment(), process.env.NODE_ENV, identity.email)) return { allowed: true, status: "approved" as const };
  const url = databaseUrl();
  if (!url) return { allowed: false, status: null };
  const actorPersonId = await findOrClaimPersonForAuthIdentity(identity, url);
  if (!actorPersonId) return { allowed: false, status: null };
  if (identity.email) await claimBetaOrganizerInvite(actorPersonId, identity.email, url, !betaActivationEnabled());
  const access = await getEventCreationAccess(actorPersonId, url);
  return eventCreationDecision({ publicFreeBeta: publicFreeBetaEnabled() || betaActivationEnabled(), requestOnly: closedBetaRequired() || marketingOnlyEnabled(), accessStatus: access?.status ?? null, hasClaimedEmail: Boolean(identity.email?.trim()) });
}

export async function requireEventCreationAccess(identity: { authUserId: string; email?: string; displayName?: string }) {
  const access = await accessForIdentity(identity);
  if (!access.allowed) throw new EventCreationAccessRequiredError();
}

async function creationOptions() {
  const url = databaseUrl();
  if (!url) throw new Error("Commons database persistence is not configured.");
  if (!isSupabaseAuthConfigured()) {
    const actorPersonId = getLocalDevelopmentPilotActorId();
    if (!actorPersonId) throw new CommonsAuthenticationRequiredError();
    return { databaseUrl: url, actorPersonId };
  }
  const identity = await getCommonsAuthIdentity();
  if (!identity) throw new CommonsAuthenticationRequiredError();
  const actorPersonId = await findOrClaimPersonForAuthIdentity(identity, url);
  if (!actorPersonId) throw new CommonsMembershipRequiredError();
  await requireEventCreationAccess(identity);
  return { databaseUrl: url, actorPersonId };
}

export async function getEventCreationPageAccess() {
  if (!isSupabaseAuthConfigured()) {
    const actorPersonId = getLocalDevelopmentPilotActorId();
    return {
      signedIn: Boolean(actorPersonId),
      allowed: Boolean(actorPersonId),
      status: actorPersonId ? "approved" : null,
    };
  }
  const identity = await getCommonsAuthIdentity();
  const access = identity ? await accessForIdentity(identity) : { allowed: false, status: null };
  return {
    signedIn: Boolean(identity),
    allowed: access.allowed,
    status: access.status,
  };
}

export async function requestAuthenticatedEventCreationAccess(resumeDraftId?: string) {
  const url = databaseUrl();
  if (!url) throw new Error("Commons database persistence is not configured.");
  const identity = await getCommonsAuthIdentity();
  if (!identity) throw new CommonsAuthenticationRequiredError();
  if (!identity.email) throw new Error("Your signed-in account does not have an email address.");
  const actorPersonId = await findOrClaimPersonForAuthIdentity(identity, url);
  if (!actorPersonId) throw new CommonsMembershipRequiredError();
  const access = await requestEventCreationAccess({ personId: actorPersonId, email: identity.email, ...(resumeDraftId && betaActivationEnabled() ? { resumeDraftId } : {}) }, url);
  if (access.status === "requested") scheduleOperatorNotification(`beta-access:${access.personId}:${access.requestedAt.toISOString()}`);
  return access;
}

export async function loadRecentEventsForCreation() {
  const options = await creationOptions();
  return listRecentReusableEvents(options);
}

export async function createAuthenticatedEventDraft(input: unknown) {
  const options = await creationOptions();
  if (!betaActivationEnabled()) return createEventCreationDraft(input, options);
  const raw = input && typeof input === "object" ? (input as { entryContext?: unknown }).entryContext : undefined;
  const entryContext = raw && typeof raw === "object" ? parseTripEntryContext(raw as Record<string, unknown>) : {};
  return createEventCreationDraft(input, { ...options, betaActivationRequired: true, entryContext: Object.keys(entryContext).length ? entryContext : undefined });
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

/** Free beta abuse bound: accounts without pilot access may create this many trips per rolling 24 hours. */
export const FREE_BETA_DAILY_TRIP_LIMIT = 5;

export class EventCreationLimitError extends Error {
  constructor() {
    super("You’ve started several trips today. Try again tomorrow, or open one of your trips.");
    this.name = "EventCreationLimitError";
  }
}

export async function commitAuthenticatedEventDraft(draftId: string, input: unknown) {
  const options = { ...await creationOptions(), newExperience: betaReworkEnabled() };
  if ((publicFreeBetaEnabled() || betaActivationEnabled()) && !(await accountHasPilotCapabilities(options.actorPersonId, process.env, options.databaseUrl))) {
    // A retry of an already committed draft replays its result and is never blocked by the cap.
    const draft = await getEventCreationDraft(draftId, options).catch(() => null);
    if (draft?.status !== "committed" && await tripsCreatedSince(options.actorPersonId, new Date(Date.now() - 86_400_000), options.databaseUrl) >= FREE_BETA_DAILY_TRIP_LIMIT) throw new EventCreationLimitError();
  }
  return commitEventCreationDraft(draftId, input, options);
}

export async function reserveAuthenticatedSetupCoordinator(draftId:string,input:unknown){return changeSetupCoordinator(draftId,input,await creationOptions());}
export async function finishAuthenticatedSetupCoordinator(draftId:string,commandId:string,version:number,reply:string){return finishSetupCoordinator(draftId,commandId,version,reply,await creationOptions());}

/** Whether the signed-in account has explicit pilot access to the setup coordinator, independent of public signup. */
export async function currentAccountHasPilotCapabilities() {
  if (coordinatorRetired()) return false;
  const url = databaseUrl();
  if (!url) return false;
  if (!isSupabaseAuthConfigured()) {
    const actorPersonId = getLocalDevelopmentPilotActorId();
    return actorPersonId ? accountHasPilotCapabilities(actorPersonId, process.env, url) : false;
  }
  const identity = await getCommonsAuthIdentity();
  if (!identity) return false;
  const personId = await findOrClaimPersonForAuthIdentity(identity, url);
  return personId ? accountHasPilotCapabilities(personId, process.env, url) : false;
}

/** After commit: should the organizer land in Coordinator? Only when the new trip's server-resolved capabilities include it. */
export async function newTripOpensCoordinator(tripId: string) {
  const identity = isSupabaseAuthConfigured() ? await getCommonsAuthIdentity() : null;
  if (!identity && isSupabaseAuthConfigured()) return false;
  // Only the trip's own organizer learns its capabilities; anyone else gets the same answer as a free trip.
  const snapshot = await loadCommonsSnapshot(tripId).catch(() => null);
  if (!snapshot || snapshot.currentActor.role !== "organizer") return false;
  return (await resolveTripCapabilities(snapshot.commons.id)).coordinator;
}
