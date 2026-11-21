import "server-only";

import { createCommonsPoll, PollRepositoryError, reservePollFraming, getPollDeliveryReview, queuePollDeliveries, getEventAttendance, setEventAttendance, revokePollRecipient, approvePollDecision, listCommonsPollDrafts, saveCommonsPollDraft, deleteCommonsPollResponse, findOrClaimPersonForAuthIdentity, getCommonsPollDetail, getPublicPollByPublicId, getPublicPollByToken, getPendingPollInvitation, localDevelopmentPollViewer, submitPublicPollResponse, submitPublicPollResponseByPublicId, updateCommonsPollStatus } from "@commons/database";
import { getLocalDevelopmentPilotActorId, isSignInConfigured } from "@/lib/supabase/config";
import { getCommonsAuthIdentity, getVerifiedAuthUser } from "@/lib/supabase/server";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "./commons";
import { commonsDatabaseUrl } from "./runtime-environment";
import { currentSignInMethod } from "./sign-in-method";
import { getSupabaseVerifiedAuthUserEmail } from "@/lib/supabase/admin";

function databaseUrl() {
  return commonsDatabaseUrl() ?? undefined;
}

/** Shared by other authenticated server modules so identity resolution has one implementation. */
export { pollOptions as authenticatedPollOptions };
async function pollOptions() {
  const url = databaseUrl();
  if (!url) throw new Error("Commons database persistence is not configured.");
  if (isSignInConfigured()) {
    const identity = await getCommonsAuthIdentity();
    if (!identity) throw new CommonsAuthenticationRequiredError();
    const actorPersonId = await findOrClaimPersonForAuthIdentity(identity, url);
    if (!actorPersonId) throw new CommonsMembershipRequiredError();
    return { databaseUrl: url, actorPersonId, resolveVerifiedEmail: getSupabaseVerifiedAuthUserEmail };
  }
  const actorPersonId = getLocalDevelopmentPilotActorId();
  if (!actorPersonId) throw new CommonsAuthenticationRequiredError();
  return { databaseUrl: url, actorPersonId };
}

export async function loadAuthenticatedEventAttendance(slug: string) {
  return getEventAttendance(slug, await pollOptions());
}
/** Poll framing help: organizer, own saved draft, shared pool of 100 an hour. Replays return the stored result. */
export async function reserveAuthenticatedPollInference(slug: string, input: unknown) {
  return reservePollFraming(slug, input, await pollOptions());
}

export async function loadAuthenticatedPollDelivery(slug: string, pollId: string, audience?: unknown) {
  return getPollDeliveryReview(slug, pollId, await pollOptions(), audience);
}
export async function queueAuthenticatedPollDelivery(slug: string, pollId: string, input: unknown) {
  return queuePollDeliveries(slug, pollId, input, await pollOptions());
}

export async function saveAuthenticatedEventAttendance(slug: string, input: unknown) {
  return setEventAttendance(slug, input, await pollOptions());
}
export async function revokeAuthenticatedPollRecipient(slug: string, pollId: string, input: unknown) {
  return revokePollRecipient(slug, pollId, input, await pollOptions());
}
export async function approveAuthenticatedPollDecision(slug: string, pollId: string, input: unknown) {
  return approvePollDecision(slug, pollId, input, await pollOptions());
}

export async function createAuthenticatedPoll(slug: string, input: unknown) {
  const poll = await createCommonsPoll(slug, input, await pollOptions());
  await (await import("./messaging/dispatch")).textAboutPublishedPoll(poll.id);
  return poll;
}

export async function loadAuthenticatedPollDrafts(slug: string, draftId?: string) {
  return listCommonsPollDrafts(slug, await pollOptions(), draftId);
}

export async function saveAuthenticatedPollDraft(slug: string, input: unknown) {
  return saveCommonsPollDraft(slug, input, await pollOptions());
}

export async function loadAuthenticatedPoll(slug: string, pollId: string) {
  return getCommonsPollDetail(slug, pollId, await pollOptions());
}

export async function pollEventNavigation(slug: string, pollId: string) {
  try {
    const poll = await loadAuthenticatedPoll(slug, pollId);
    return { eventHref: `/c/${slug}`, pollsHref: `/c/${slug}/polls`, manageHref: poll.currentActorCanManage ? `/c/${slug}/polls/${pollId}` : undefined };
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError || error instanceof CommonsMembershipRequiredError || (error instanceof PollRepositoryError && error.code === "poll_not_found")) return {};
    throw error;
  }
}

export async function removeAuthenticatedPollResponse(slug: string, pollId: string, responseId: string) {
  return deleteCommonsPollResponse(slug, pollId, responseId, await pollOptions());
}

export async function setAuthenticatedPollStatus(slug: string, pollId: string, input: unknown) {
  return updateCommonsPollStatus(slug, pollId, input, await pollOptions());
}

export async function loadPublicPoll(shareToken: string) {
  const url = databaseUrl();
  if (!url) return null;
  return getPublicPollByToken(shareToken, url, await authenticatedPollViewer());
}

export async function loadPublicPollByPublicId(publicId: string) {
  const url = databaseUrl();
  if (!url) return null;
  return getPublicPollByPublicId(publicId, url, await authenticatedPollViewer());
}

export async function savePublicPollResponse(shareToken: string, input: unknown) {
  const url = databaseUrl();
  if (!url) throw new Error("Commons database persistence is not configured.");
  return submitPublicPollResponse(shareToken, input, url, await authenticatedPollViewer());
}

export async function savePublicPollResponseByPublicId(publicId: string, input: unknown) {
  const url = databaseUrl();
  if (!url) throw new Error("Commons database persistence is not configured.");
  return submitPublicPollResponseByPublicId(publicId, input, url, await authenticatedPollViewer());
}

export async function authenticatedPollViewer() {
  if (!isSignInConfigured()) {
    const localActor = getLocalDevelopmentPilotActorId();
    const url = databaseUrl();
    return localActor && url ? localDevelopmentPollViewer(localActor, url) : undefined;
  }
  const verified = await getVerifiedAuthUser();
  if (!verified) return undefined;
  return { authUserId: verified.authUserId, email: verified.email };
}

export async function pendingPollInvitation(publicId: string) {
  // With password sign-in a typed address proves nothing, so it never finds someone's personal invitation link.
  if (await currentSignInMethod() === "password") return null;
  const viewer = await authenticatedPollViewer();
  const url = databaseUrl();
  return viewer && url ? getPendingPollInvitation(publicId, viewer, url) : null;
}
