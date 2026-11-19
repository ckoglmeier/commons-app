import { canUseActivityDecisions } from "./activity-decision-access";
import { canUseCoordinatorBackgroundResearch } from "./coordinator-search-access";
import { CoordinatorTurnError, type CoordinatorTurnFence } from "@commons/database";
import "server-only";
import { nativeLodgingSelected } from "@/lib/server/lodging/config";

import {
  coordinatorPreferencesForTrip,
  tripPlanningContext,
  tripChangeContextForTrip,
  createCommonsPoll,
  queueResearchTask, listResearchTasks, researchWorkspaceScope, cancelResearchTask,
  listCoordinatorTasks, readCoordinatorTask, startCoordinatorTask, amendCoordinatorTask, cancelCoordinatorTask, readCoordinatorTaskHistory, linkTaskOutcomeToMain, listThreadOutcomes,
  ensureMainThread, startSubthread, listThreadRelations,
  getCoordinatorThread,
  listCoordinatorRecommendations,
  reserveCoordinatorInference,
  commitCoordinatorTurn,
  actOnCoordinatorWorkspace,
  actOnCoordinatorThreadIdea,
  createCoordinatorThread,
  updateCoordinatorThread,
  hasCoordinatorTurnReplay,
  beginCoordinatorTurn,
  completeCoordinatorTurn,
  failCoordinatorTurn,
  findCoordinatorTurnByCommand,
  loadCoordinatorTripContext,
  readThreadExcerpt,
  PollRepositoryError,
  reservePollInference,
  reservePollFraming,
  FREE_TRIP_POLL_ASSIST_HOURLY_CAP,
  getPollDeliveryReview,
  queuePollDeliveries,
  getEventAttendance,
  setEventAttendance,
  revokePollRecipient,
  approvePollDecision,
  listCommonsPollDrafts,
  saveCommonsPollDraft,
  reopenCoordinatorDraft,
  savePublishedPollDeliveryNote,
  getPollDraftRecipientReview,
  deleteCommonsPollResponse,
  findOrClaimPersonForAuthIdentity,
  getCommonsPollDetail,
  getPublicPollByPublicId,
  getPublicPollByToken,
  getPendingPollInvitation,
  localDevelopmentPollViewer,
  submitPublicPollResponse,
  submitPublicPollResponseByPublicId,
  updateCommonsPollStatus,
  reserveTurnInference,
  stopCoordinatorTurn,
  interruptCoordinatorTurn,
  coordinatorTurnAttemptIsLive,
} from "@commons/database";
import {
  getLocalDevelopmentPilotActorId,
  isSupabaseAuthConfigured,
} from "@/lib/supabase/config";
import { createSupabaseServerClient, getCommonsAuthIdentity } from "@/lib/supabase/server";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "./commons";
import { commonsDatabaseUrl, messageDeliveryConfigured } from "./runtime-environment";
import { getSupabaseVerifiedAuthUserEmail } from "@/lib/supabase/admin";
import { currentTurnPrincipal } from "./turn-principal";
import { isCommonsOperatorEmail } from "./operator-accounts";
import { resolveTripCapabilities } from "./trip-capabilities";

function databaseUrl() {
  return commonsDatabaseUrl() ?? undefined;
}

/** Shared by other authenticated server modules so identity resolution has one implementation. */
export { pollOptions as authenticatedPollOptions };
async function pollOptions(slug?: string) {
  const url = databaseUrl();
  if (!url) throw new Error("Commons database persistence is not configured.");
  // A durable turn executing in the runner (A2): the stored owner of the claimed turn. A slug for another trip is refused here; calls without a
  // slug, and commons.ts databaseOptions, act as that person, and every repository re-checks membership in the trip it is asked about.
  const principal = currentTurnPrincipal();
  if (principal) {
    if (slug && slug !== principal.tripId) throw new CommonsMembershipRequiredError();
    return { databaseUrl: url, actorPersonId: principal.actorPersonId, sharedCoordinator: sharedWorkspaceForTrip(slug), inferenceLimitExempt: isCommonsOperatorEmail(principal.verifiedEmail), ...(isSupabaseAuthConfigured() ? { resolveVerifiedEmail: getSupabaseVerifiedAuthUserEmail } : {}) };
  }
  if (isSupabaseAuthConfigured()) {
    const identity = await getCommonsAuthIdentity();
    if (!identity) throw new CommonsAuthenticationRequiredError();
    const actorPersonId = await findOrClaimPersonForAuthIdentity(identity, url);
    if (!actorPersonId) throw new CommonsMembershipRequiredError();
    return { databaseUrl: url, actorPersonId, sharedCoordinator: sharedWorkspaceForTrip(slug), inferenceLimitExempt: isCommonsOperatorEmail(identity.email), resolveVerifiedEmail: getSupabaseVerifiedAuthUserEmail };
  }
  const actorPersonId = getLocalDevelopmentPilotActorId();
  if (!actorPersonId) throw new CommonsAuthenticationRequiredError();
  return { databaseUrl: url, actorPersonId, sharedCoordinator: sharedWorkspaceForTrip(slug), inferenceLimitExempt: false };
}

function sharedWorkspaceForTrip(slug?: string) {
  // All trips use Workspace. This chooses the shared-record scope, not access:
  // repository commands still require active organizer membership and filter
  // legacy private records separately. UUID and slug URLs behave identically.
  return Boolean(slug);
}

export async function loadAuthenticatedEventAttendance(slug: string) {
  return getEventAttendance(slug, await pollOptions());
}
export async function loadAuthenticatedCoordinatorThread(slug: string, before?: number, threadId?: string) {
  return getCoordinatorThread(slug, await pollOptions(slug), before, threadId);
}
export async function loadAuthenticatedCoordinatorRecommendations(slug: string) {
  const options = await pollOptions(slug);
  // Legacy operator-prepared recommendations were private. Do not feed them to a shared conversation.
  return options.sharedCoordinator ? [] : listCoordinatorRecommendations(slug, options);
}
export async function reserveAuthenticatedCoordinatorInference(slug: string, input: unknown) {
  return reserveCoordinatorInference(slug, input, await pollOptions(slug));
}
export async function hasAuthenticatedCoordinatorReplay(slug: string, input: unknown) {
  return hasCoordinatorTurnReplay(slug, input, await pollOptions(slug));
}
export async function commitAuthenticatedCoordinatorTurn(slug: string, input: unknown, reply: string, data: import("@commons/contracts").PollWorkingData | null, workspace?: import("@commons/contracts").CoordinatorWorkspace) {
  return commitCoordinatorTurn(slug, input, reply, data, await pollOptions(slug), workspace);
}
export async function beginAuthenticatedCoordinatorTurn(slug: string, command: unknown, provisionalTitle: string, now?: Date, reserveInference = true, itineraryGeneration = false, durable?: Parameters<typeof beginCoordinatorTurn>[2]["durable"]) {
  return beginCoordinatorTurn(slug, command, { ...await pollOptions(slug), provisionalTitle, reserveInference, itineraryGeneration, ...(now ? { now } : {}), ...(durable ? { durable } : {}) });
}
export async function completeAuthenticatedCoordinatorTurn(slug: string, input: Parameters<typeof completeCoordinatorTurn>[1]) {
  return completeCoordinatorTurn(slug, input, await pollOptions(slug));
}
export async function failAuthenticatedCoordinatorTurn(slug: string, input: Parameters<typeof failCoordinatorTurn>[1]) {
  return failCoordinatorTurn(slug, input, await pollOptions(slug));
}
export async function stopAuthenticatedCoordinatorTurn(slug: string, commandId: string) {
  return stopCoordinatorTurn(slug, { commandId }, await pollOptions(slug));
}
export async function interruptAuthenticatedCoordinatorTurn(slug: string, input: Parameters<typeof interruptCoordinatorTurn>[1]) {
  return interruptCoordinatorTurn(slug, input, await pollOptions(slug));
}
export async function authenticatedTurnAttemptIsLive(slug: string, input: { commandId: string; attempt: number }) {
  return coordinatorTurnAttemptIsLive(slug, input, await pollOptions(slug));
}
export async function findAuthenticatedCoordinatorTurn(slug: string, commandId: string, now?: Date) {
  return findCoordinatorTurnByCommand(slug, commandId, { ...await pollOptions(slug), ...(now ? { now } : {}) });
}
export async function loadAuthenticatedTripContext(slug: string, input: { activeThreadId?: string; includeOwnTravel?: boolean; capabilities?: import("@commons/contracts").CapabilityId[]; now?: Date } = {}) {
  return loadCoordinatorTripContext(slug, { ...await pollOptions(slug), ...input });
}
export async function readAuthenticatedThreadExcerpt(slug: string, threadId: string) {
  return readThreadExcerpt(slug, threadId, { ...await pollOptions(slug), maxTurns: 6, maxChars: 2_400 });
}
/** The lodging continuation setting comes from server rollout configuration; `seams` exists only for the crash-before-commit test. */
export async function actOnAuthenticatedCoordinatorWorkspace(slug: string, input: unknown, seams: { lodgingCrashPoint?: (point: "prepared_before_commit") => void } = {}) {
  const options = await pollOptions(slug);
  const itinerary = input !== null && typeof input === "object" && "action" in input && input.action === "itinerary";
  return actOnCoordinatorWorkspace(slug, input, { ...options, ...(itinerary ? { activityDecisionsEnabled: await canUseActivityDecisions() } : {}), lodgingContinuationEnabled: await nativeLodgingSelected(slug, options.actorPersonId), ...seams });
}
export async function createAuthenticatedCoordinatorThread(slug: string, input: unknown) { return createCoordinatorThread(slug, input, await pollOptions(slug)); }
export async function updateAuthenticatedCoordinatorThread(slug: string, input: unknown) { return updateCoordinatorThread(slug, input, await pollOptions(slug)); }
export async function actOnAuthenticatedCoordinatorThreadIdea(slug: string, input: unknown) { return actOnCoordinatorThreadIdea(slug, input, await pollOptions(slug)); }
export async function coordinatorWorkspaceEnabled(slug: string) {
  await pollOptions(slug);
  return sharedWorkspaceForTrip(slug);
}
/** Poll framing help: organizer, own saved draft, shared pool of 100 an hour, and a stricter cap on free trips. A trip that paid to invite isn't limited. Replays return the stored result. */
export async function reserveAuthenticatedPollInference(slug: string, input: unknown) {
  const capabilities = await resolveTripCapabilities(slug), options = await pollOptions();
  if (!capabilities.pollAssistance) throw new CommonsMembershipRequiredError();
  return reservePollFraming(slug, input, { ...options, inferenceLimitExempt: options.inferenceLimitExempt || capabilities.tier === "beta" }, { hourlyCap: capabilities.tier === "free" ? FREE_TRIP_POLL_ASSIST_HOURLY_CAP : undefined });
}
export async function reserveAuthenticatedReviewInference(slug: string, input: unknown) {
  const capabilities = await resolveTripCapabilities(slug), options = await pollOptions();
  return reservePollInference(slug, input, { ...options, inferenceLimitExempt: options.inferenceLimitExempt || capabilities.tier === "beta" }, "review");
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
  if (messageDeliveryConfigured()) await (await import("./messaging/dispatch")).textAboutPublishedPoll(poll.id);
  return poll;
}

export async function loadAuthenticatedPollDrafts(slug: string, draftId?: string) {
  return listCommonsPollDrafts(slug, await pollOptions(), draftId);
}
export async function loadAuthenticatedDraftRecipients(slug: string, draftId: string, version: number) {
  return getPollDraftRecipientReview(slug, draftId, version, await pollOptions());
}

export async function saveAuthenticatedPollDraft(slug: string, input: unknown, threadId?: string) {
  return saveCommonsPollDraft(slug, input, await pollOptions(slug), threadId ? { threadId } : undefined);
}
export async function reopenAuthenticatedCoordinatorDraft(slug: string, draftId: string, version: number) {
  return reopenCoordinatorDraft(slug, draftId, version, await pollOptions(slug));
}
export async function saveAuthenticatedPublishedDeliveryNote(slug: string, draftId: string, version: number, communication: unknown) {
  return savePublishedPollDeliveryNote(slug, draftId, version, communication, await pollOptions(slug));
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
  if (!isSupabaseAuthConfigured()) {
    const localActor = getLocalDevelopmentPilotActorId();
    const url = databaseUrl();
    return localActor && url ? localDevelopmentPollViewer(localActor, url) : undefined;
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return undefined;
  return { authUserId: data.user.id, email: data.user.email_confirmed_at ? data.user.email ?? null : null };
}

export async function pendingPollInvitation(publicId: string) {
  const viewer = await authenticatedPollViewer();
  const url = databaseUrl();
  return viewer && url ? getPendingPollInvitation(publicId, viewer, url) : null;
}

export async function authenticatedResearchTasks(slug: string, threadId: string) {
  const options = await pollOptions(slug);
  const eventId = await researchWorkspaceScope(slug, threadId, options);
  return listResearchTasks(eventId, threadId, options);
}
export async function queueAuthenticatedResearch(slug: string, input: { commandId: string; threadId: string; query: string }) {
  if (!await canUseCoordinatorBackgroundResearch()) throw new CoordinatorTurnError("unsupported_capability");
  const options = await pollOptions(slug);
  const commonsId = await researchWorkspaceScope(slug, input.threadId, options);
  return queueResearchTask({ protocolVersion: 1, commandId: input.commandId, commonsId, threadId: input.threadId,
    parentTaskId: null, caller: { kind: "human", personId: options.actorPersonId }, capability: "research.public_sources",
    input: { query: input.query }, routing: { kind: "commons_specialist" }, returnTo: { kind: "commons_thread", threadId: input.threadId },
  }, options);
}
export async function cancelAuthenticatedResearch(slug: string, threadId: string, taskId: string) {
  const options = await pollOptions(slug);
  const eventId = await researchWorkspaceScope(slug, threadId, options);
  return cancelResearchTask(taskId, { ...options, commonsId: eventId, threadId });
}

/*
 * Continuity (steerable tasks, main conversation, subthreads). Each call authenticates the person and resolves the trip and thread from the URL scope
 * before any caller-supplied task or thread id is used; the database re-checks organizer standing, ownership and revision in its own transaction.
 */
export async function authenticatedCoordinatorTasks(slug: string, threadId: string) {
  const options = await pollOptions(slug);
  return listCoordinatorTasks(await researchWorkspaceScope(slug, threadId, options), threadId, options);
}
export async function authenticatedCoordinatorTask(slug: string, threadId: string, taskId: string) {
  const options = await pollOptions(slug);
  return readCoordinatorTask(taskId, { ...options, commonsId: await researchWorkspaceScope(slug, threadId, options), threadId });
}
export async function authenticatedCoordinatorTaskHistory(slug: string, threadId: string, taskId: string) {
  const options = await pollOptions(slug);
  return readCoordinatorTaskHistory(taskId, { ...options, commonsId: await researchWorkspaceScope(slug, threadId, options), threadId });
}
export async function startAuthenticatedCoordinatorTask(slug: string, input: { commandId: string; threadId: string; title: string; brief: string; query: string; contextVersion?: number | null }, turnFence?: CoordinatorTurnFence) {
  if (!await canUseCoordinatorBackgroundResearch()) throw new CoordinatorTurnError("unsupported_capability");
  const options = { ...await pollOptions(slug), turnFence };
  const commonsId = await researchWorkspaceScope(slug, input.threadId, options);
  return startCoordinatorTask({ protocolVersion: 1, commandId: input.commandId, commonsId, threadId: input.threadId, parentTaskId: null,
    caller: { kind: "human", personId: options.actorPersonId }, capability: "research.public_sources", input: { query: input.query },
    routing: { kind: "commons_specialist" }, returnTo: { kind: "commons_thread", threadId: input.threadId } },
  { title: input.title, brief: input.brief.trim() ? input.brief : input.title, contextVersion: input.contextVersion ?? null }, options);
}
export async function amendAuthenticatedCoordinatorTask(slug: string, input: { threadId: string; taskId: string; commandId: string; expectedRevision: number; note: string; publicQuery?: string; missingFact?: string }, turnFence?: CoordinatorTurnFence) {
  if (!await canUseCoordinatorBackgroundResearch()) throw new CoordinatorTurnError("unsupported_capability");
  const options = { ...await pollOptions(slug), turnFence };
  await researchWorkspaceScope(slug, input.threadId, options);
  const task = await readCoordinatorTask(input.taskId, { ...options, threadId: input.threadId });
  if (task.threadId !== input.threadId) throw new Error("Task is not in this thread.");
  return amendCoordinatorTask({ taskId: input.taskId, commandId: input.commandId, expectedRevision: input.expectedRevision, note: input.note,
    ...(input.publicQuery ? { publicQuery: input.publicQuery } : {}), ...(input.missingFact ? { missingFact: input.missingFact } : {}) }, options);
}
export async function cancelAuthenticatedCoordinatorTask(slug: string, input: { threadId: string; taskId: string; commandId: string }, turnFence?: CoordinatorTurnFence) {
  const options = { ...await pollOptions(slug), turnFence };
  await researchWorkspaceScope(slug, input.threadId, options);
  await readCoordinatorTask(input.taskId, { ...options, threadId: input.threadId });
  return cancelCoordinatorTask({ taskId: input.taskId, commandId: input.commandId }, options);
}
export async function ensureAuthenticatedMainThread(slug: string) { return ensureMainThread(slug, await pollOptions(slug)); }
export async function startAuthenticatedSubthread(slug: string, input: Parameters<typeof startSubthread>[1]) { return startSubthread(slug, input, await pollOptions(slug)); }
export async function authenticatedThreadRelations(slug: string) { return listThreadRelations(slug, await pollOptions(slug)); }
export async function linkAuthenticatedTaskOutcome(slug: string, threadId: string, input: { taskId: string; revision: number }) {
  const options = await pollOptions(slug);
  await researchWorkspaceScope(slug, threadId, options);
  await readCoordinatorTask(input.taskId, { ...options, threadId });
  return linkTaskOutcomeToMain(input, options);
}
export async function authenticatedThreadOutcomes(slug: string, threadId: string) {
  const options = await pollOptions(slug);
  return listThreadOutcomes(await researchWorkspaceScope(slug, threadId, options), threadId, options);
}

export async function authenticatedCoordinatorPreferences(slug:string,input?:unknown) { return coordinatorPreferencesForTrip(slug,await pollOptions(slug),input); }
export async function authenticatedTripChangeContext(slug: string) { return tripChangeContextForTrip(slug, await pollOptions(slug)); }
/** The verified actor and database for the native lodging journey. Derived on the server from the signed-in session, never from a request body. */
export async function authenticatedCoordinationOptions(slug: string) { const { databaseUrl, actorPersonId } = await pollOptions(slug); return { databaseUrl, actorPersonId }; }
/** One hourly inference slot for this turn attempt, keyed exactly as the turn's own reservation, so a native lodging resolver call is counted once. */
export async function reserveAuthenticatedTurnInference(slug: string, input: { commandId: string; attempt: number }) { return reserveTurnInference(slug, input, await pollOptions(slug)); }


/** Task goals use the same authenticated actor boundary as existing commands. */
export async function authenticatedGoalOptions(slug: string) { return pollOptions(slug); }

export async function authenticatedTripPlanningContext(slug: string, input?: unknown) { return tripPlanningContext(slug, await pollOptions(slug), input); }
