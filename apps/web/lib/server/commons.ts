import "server-only";
import { currentTurnPrincipal } from "./turn-principal";
import { autoSendTravelerInvitation } from "./traveler-invitation-delivery";

import {
  addCommonsMoment,
  addCommonsPerson,
  inviteManagedTraveler,
  addCommonsExpense,
  addCommonsReimbursement,
  addCommonsStay,
  setCommonsPlacePin,
  addCommonsItineraryItem,
  approveCommonsProposal,
  claimCommonsInvitation,
  commitCommonsSetupImport,
  completeCommonsSetupWithoutSharing,
  completeInvitationDeliveryAttempt,
  cacheInvitationAuthenticationEntry,
  getInvitationEntryContext,
  sealInvitationEmailProof,
  confirmCommonsExpensesComplete,
  CommonsRepositoryError,
  deleteCommonsExpense,
  deleteCommonsReimbursement,
  deleteCommonsItineraryItem,
  deleteCommonsMoment,
  deleteCommonsStay,
  deleteCommonsTravelPlan,
  findOrClaimPersonForAuthIdentity,
  findPersonProfileForAuthUser,
  getCommonsMomentAsset,
  getCommonsCoverAsset,
  getCommonsConfirmationAsset,
  findCommonsConfirmationImport,
  getCommonsPeople,
  getCommonsInvitationLink,
  getCommonsInvitationPreview,
  getCommonsSetup,
  getCommonsSnapshot,
  listCommonsMembershipsForPerson,
  listPendingCommonsInvitationsForIdentity,
  leaseInvitationDeliveryAttempt,
  revalidateInvitationDeliveryAttempt,
  queueCommonsInvitationDeliveries,
  reopenCommonsExpenses,
  reviseCommonsProposal,
  revokeCommonsInvitation,
  rotateCommonsInvitationLink,
  updateCommonsCover,
  updateCommonsArchived,
  updateCommonsTitle,
  updateTripLetter,
  updateCommonsDetails,
  updateCommonsExpense,
  updateCommonsReimbursement,
  updateCommonsItineraryItem,
  updateCommonsMoment,
  updateCommonsStay,
  updateCommonsMemberRole,
  updateCommonsPendingInvitation,
  updateCommonsParticipation,
  updateCommonsTargetBudget,
  updateCommonsMoneySettings,
  upsertCommonsTravelPlan,
  upsertCommonsFlightBooking,
  updateCommonsTravelPlanSharing,
  saveCommonsSetupTravelers,
  blockCommonsMemberRemoval,
} from "@commons/database";
import { CommonsPeopleSchema, InvitationDeliveryActionSchema, InvitationLinkSchema, SendSetupInvitationsResultSchema, type CommonsMembershipSummary, type CommonsSnapshot } from "@commons/contracts";
import type { PendingCommonsInvitationSummary } from "@commons/database";
import { pilotSnapshot } from "@/lib/pilot-fixture";
import {
  getLocalDevelopmentPilotActorId,
  isSupabaseAuthConfigured,
} from "@/lib/supabase/config";
import {
  getCommonsAuthIdentity,
  createSupabaseServerClient,
  type CommonsAuthIdentity,
} from "@/lib/supabase/server";
import { renderCommonsInvitationEmail } from "@/lib/email/invitation-email";
import { renderCommonsAuthenticationEmail } from "@/lib/email/authentication-email";
import { createPasswordlessEmailProof, getSupabaseAuthUserEmail } from "@/lib/supabase/admin";
import { invitationReturnPath } from "@/lib/invitation-entry-flow";
import { EmailDeliveryError, sendEmail } from "@/lib/email/resend";
import { createPublicDemoSnapshotLookup } from "./public-demo";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
} from "./commons-access-errors";
import { commonsDatabaseUrl, commonsSiteOrigin } from "./runtime-environment";

export {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
} from "./commons-access-errors";

export type CommonsDataMode = "database" | "demo";

const publicDemoSlug = pilotSnapshot.commons.slug;
const publicDemoId = pilotSnapshot.commons.id;

function databaseUrl() {
  return commonsDatabaseUrl();
}

async function authenticatedIdentity() {
  if (!isSupabaseAuthConfigured()) {
    throw new CommonsAuthenticationRequiredError();
  }
  const identity = await getCommonsAuthIdentity();
  if (!identity) throw new CommonsAuthenticationRequiredError();
  return identity;
}

async function databaseOptions(identity?: CommonsAuthIdentity) {
  const url = databaseUrl();
  if (!url) return null;
  // A durable Coordinator turn in the runner (conversation durability A2): the claimed turn's stored owner, as in `pollOptions`.
  const principal = currentTurnPrincipal();
  if (principal && !identity) return { databaseUrl: url, actorPersonId: principal.actorPersonId };

  if (isSupabaseAuthConfigured()) {
    const resolvedIdentity = identity ?? await authenticatedIdentity();
    const actorPersonId = await findOrClaimPersonForAuthIdentity(
      resolvedIdentity!,
      url,
    );
    if (!actorPersonId) throw new CommonsMembershipRequiredError();
    return { databaseUrl: url, actorPersonId };
  }

  const actorPersonId = getLocalDevelopmentPilotActorId();
  if (!actorPersonId) throw new CommonsAuthenticationRequiredError();
  return { databaseUrl: url, actorPersonId };
}

export async function authenticatedCommonsRepositoryOptions() {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  return options;
}

export function getCommonsDataMode(identifier?: string): CommonsDataMode {
  if (identifier && publicDemoSnapshotByIdentifier.has(identifier)) return "demo";
  return databaseUrl() ? "database" : "demo";
}

const publicDemoSnapshotByIdentifier = createPublicDemoSnapshotLookup(pilotSnapshot);

export function isPublicDemoCommonsIdentifier(identifier: string) {
  return identifier === publicDemoId || identifier === publicDemoSlug;
}

export function loadPublicCommonsMemberships(): CommonsMembershipSummary[] {
  return [];
}

export async function loadCurrentCommonsMemberships(): Promise<
  CommonsMembershipSummary[]
> {
  const url = databaseUrl();
  if (!url) return [];

  if (isSupabaseAuthConfigured()) {
    const identity = await getCommonsAuthIdentity();
    if (!identity) return [];
    const personId = await findOrClaimPersonForAuthIdentity(identity!, url);
    const memberships = personId
      ? await listCommonsMembershipsForPerson(personId, url)
      : [];
    return memberships.filter(
      (membership) => membership.commons.slug !== publicDemoSlug,
    );
  }

  const personId = getLocalDevelopmentPilotActorId();
  if (!personId) return [];
  const memberships = personId
    ? await listCommonsMembershipsForPerson(personId, url)
    : [];
  return memberships.filter(
    (membership) => membership.commons.slug !== publicDemoSlug,
  );
}

export async function loadCurrentPendingInvitations(): Promise<PendingCommonsInvitationSummary[]> {
  const url = databaseUrl();
  if (!url || !isSupabaseAuthConfigured()) return [];
  const identity = await getCommonsAuthIdentity();
  if (!identity?.email) return [];
  return listPendingCommonsInvitationsForIdentity(identity, url);
}

export async function loadCommonsSnapshot(
  identifier: string,
): Promise<CommonsSnapshot | null> {
  const demoSnapshot = publicDemoSnapshotByIdentifier.get(identifier);
  if (demoSnapshot) return demoSnapshot;
  const options = await databaseOptions();
  if (options) {
    try {
      const snapshot = await getCommonsSnapshot(identifier, options);
      return snapshot ?? null;
    } catch (error) {
      if (
        error instanceof CommonsRepositoryError &&
        (error.code === "actor_not_found" || error.code === "actor_not_authorized")
      ) {
        throw new CommonsMembershipRequiredError();
      }
      throw error;
    }
  }
  return null;
}

export async function persistTravelPlan(slug: string, input: unknown) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo travel plans stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return upsertCommonsTravelPlan(slug, input, options);
}

export async function persistFlightBooking(slug: string, input: unknown) {
  if (slug === publicDemoSlug) throw new Error("Cape Cod demo flight bookings stay on this device.");
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  return upsertCommonsFlightBooking(slug, input, options);
}

export async function persistTravelPlanSharing(slug: string, input: unknown) {
  if (slug === publicDemoSlug) throw new Error("Cape Cod demo travel plans stay on this device.");
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  return updateCommonsTravelPlanSharing(slug, input, options);
}

export async function persistTravelPlanDelete(slug: string, input: unknown) {
  if (slug === publicDemoSlug) throw new Error("Cape Cod demo travel plans stay on this device.");
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  return deleteCommonsTravelPlan(slug, input, options);
}

export async function persistTargetBudget(slug: string, input: unknown) {
  if (getCommonsDataMode(slug) === "demo") {
    throw new Error("Demo target budgets stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  const snapshot = await updateCommonsTargetBudget(slug, input, options);
  if (!snapshot) throw new CommonsMembershipRequiredError();
  return snapshot;
}

export async function persistCoverUpdate(slug: string, input: unknown) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo covers stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return updateCommonsCover(slug, input, options);
}

export async function persistTripLetterUpdate(slug: string, input: unknown) {
  if (slug === publicDemoSlug) {
    throw new Error("The demo trip page stays unchanged.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return updateTripLetter(slug, input, options);
}

export async function persistTitleUpdate(slug: string, input: unknown) {
  if (slug === publicDemoSlug) {
    throw new Error("The demo trip title stays unchanged.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return updateCommonsTitle(slug, input, options);
}

export async function persistDetailsUpdate(slug: string, input: unknown) {
  if (slug === publicDemoSlug) {
    throw new Error("The demo trip details stay unchanged.");
  }
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  return updateCommonsDetails(slug, input, options);
}

export async function persistStay(slug: string, input: unknown) {
  if (slug === publicDemoSlug) throw new Error("Demo stays stay on this device.");
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  return addCommonsStay(slug, input, options);
}

export async function persistStayUpdate(slug: string, stayId: string, input: unknown) {
  if (slug === publicDemoSlug) throw new Error("Demo stays stay on this device.");
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  return updateCommonsStay(slug, stayId, input, options);
}

export async function persistPlacePin(slug: string, input: unknown) {
  if (slug === publicDemoSlug) throw new Error("Demo places stay on this device.");
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  return setCommonsPlacePin(slug, input, options);
}

export async function persistStayDelete(slug: string, stayId: string, input: unknown) {
  if (slug === publicDemoSlug) throw new Error("Demo stays stay on this device.");
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  return deleteCommonsStay(slug, stayId, input, options);
}

export async function persistMomentUpdate(
  slug: string,
  momentId: string,
  input: unknown,
) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo photos stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return updateCommonsMoment(slug, momentId, input, options);
}

export async function persistMomentDelete(
  slug: string,
  momentId: string,
  input: unknown,
) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo photos stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return deleteCommonsMoment(slug, momentId, input, options);
}

export async function persistExpense(slug: string, input: unknown) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo expenses stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return addCommonsExpense(slug, input, options);
}

export async function persistExpenseUpdate(
  slug: string,
  expenseId: string,
  input: unknown,
) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo expenses stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return updateCommonsExpense(slug, expenseId, input, options);
}

export async function persistExpenseDelete(
  slug: string,
  expenseId: string,
  input: unknown,
) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo expenses stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return deleteCommonsExpense(slug, expenseId, input, options);
}

export async function persistReimbursement(slug: string, input: unknown) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo payments stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return addCommonsReimbursement(slug, input, options);
}

export async function persistReimbursementUpdate(
  slug: string,
  reimbursementId: string,
  input: unknown,
) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo payments stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return updateCommonsReimbursement(slug, reimbursementId, input, options);
}

export async function persistReimbursementDelete(
  slug: string,
  reimbursementId: string,
  input: unknown,
) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo payments stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return deleteCommonsReimbursement(slug, reimbursementId, input, options);
}

export async function persistExpensesComplete(slug: string, input: unknown) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo confirmations stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return confirmCommonsExpensesComplete(slug, input, options);
}

export async function persistExpensesReopen(slug: string, input: unknown) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo confirmations stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return reopenCommonsExpenses(slug, input, options);
}

export async function persistCommonsArchived(slug: string, input: unknown) {
  if (slug === publicDemoSlug) {
    throw new Error("The Cape Cod demo cannot be archived.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return updateCommonsArchived(slug, input, options);
}

export async function persistItineraryItemUpdate(
  slug: string,
  itineraryItemId: string,
  input: unknown,
) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo plans stay in this browser session.");
  }
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  return updateCommonsItineraryItem(slug, itineraryItemId, input, options);
}

export async function persistItineraryItemCreate(slug: string, input: unknown) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo plans stay in this browser session.");
  }
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  return addCommonsItineraryItem(slug, input, options);
}

export async function persistItineraryItemDelete(
  slug: string,
  itineraryItemId: string,
  input: unknown,
) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo plans stay in this browser session.");
  }
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  return deleteCommonsItineraryItem(slug, itineraryItemId, input, options);
}

export async function persistParticipation(
  slug: string,
  itineraryItemId: string,
  input: unknown,
) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo responses stay in this browser session.");
  }
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  return updateCommonsParticipation(slug, itineraryItemId, input, options);
}

export async function persistMomentCreate(slug: string, input: unknown) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo photos stay in this browser session.");
  }
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  return addCommonsMoment(slug, input, options);
}

export async function loadCommonsMomentAsset(
  slug: string,
  momentId: string,
  identity?: CommonsAuthIdentity,
) {
  const options = await databaseOptions(identity);
  if (options) return getCommonsMomentAsset(slug, momentId, options);

  const snapshot = await loadCommonsSnapshot(slug);
  const moment = snapshot?.state.moments.find((entry) => entry.id === momentId);
  if (!moment) return null;
  return {
    id: moment.id,
    storagePath: `${slug}/${moment.id}.jpg`,
    mimeType: "image/jpeg",
  };
}

export async function loadCommonsCoverAsset(
  slug: string,
  variant: "original" | "card",
  identity?: CommonsAuthIdentity,
) {
  const options = await databaseOptions(identity);
  if (!options) return null;
  return getCommonsCoverAsset(slug, variant, options);
}

export async function loadCommonsConfirmationImport(slug: string, storagePath: string) {
  const options = await databaseOptions();
  if (!options) throw new CommonsAuthenticationRequiredError();
  return findCommonsConfirmationImport(slug, storagePath, options);
}

export async function loadCommonsConfirmationAsset(
  slug: string,
  resourceType: "stay" | "travel" | "expense",
  resourceId: string,
  identity?: CommonsAuthIdentity,
) {
  const options = await databaseOptions(identity);
  if (!options) return null;
  return getCommonsConfirmationAsset(slug, resourceType, resourceId, options);
}

export async function persistProposalApproval(
  slug: string,
  proposalId: string,
  input: unknown,
) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo decisions stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return approveCommonsProposal(slug, proposalId, input, options);
}

export async function persistProposalRevision(
  slug: string,
  proposalId: string,
  input: unknown,
) {
  if (slug === publicDemoSlug) {
    throw new Error("Cape Cod demo decisions stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) {
    throw new Error("Commons database persistence is not configured.");
  }
  return reviseCommonsProposal(slug, proposalId, input, options);
}

export async function loadAuthenticatedCommonsSetup(slug: string) {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  const setup = await getCommonsSetup(slug, options);
  if (!setup) throw new CommonsMembershipRequiredError();
  return setup;
}

export async function saveAuthenticatedCommonsTravelers(slug: string, input: unknown) {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  try {
    await saveCommonsSetupTravelers(slug, input, options);
  } catch (error) {
    throwSetupAccessError(error);
  }
  const setup = await getCommonsSetup(slug, options);
  if (!setup) throw new CommonsMembershipRequiredError();
  return setup;
}

export async function importAuthenticatedCommonsPlans(slug: string, input: unknown) {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  try {
    await commitCommonsSetupImport(slug, input, options);
  } catch (error) {
    throwSetupAccessError(error);
  }
  const setup = await getCommonsSetup(slug, options);
  if (!setup) throw new CommonsMembershipRequiredError();
  return setup;
}

function invitationDates(startsOn: string | null, endsOn: string | null) {
  if (!startsOn && !endsOn) return "Dates to be decided";
  const format = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  if (startsOn && !endsOn) return `Starts ${format.format(new Date(`${startsOn}T12:00:00Z`))}`;
  if (!startsOn && endsOn) return `Ends ${format.format(new Date(`${endsOn}T12:00:00Z`))}`;
  return `${format.format(new Date(`${startsOn}T12:00:00Z`))}–${format.format(new Date(`${endsOn}T12:00:00Z`))}`;
}

export async function loadAuthenticatedCommonsPeople(slug: string) {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  const result = await getCommonsPeople(slug, options);
  if (!result) throw new CommonsMembershipRequiredError();
  return CommonsPeopleSchema.parse(result);
}

async function deliverNewTravelerInvitation(slug: string, invitationId: string, deliveryAttemptId: string, options: { databaseUrl: string; actorPersonId: string }, origin?: string) {
  // The traveler and attempt have already committed. Delivery trouble must
  // preserve that saved traveler and its truthful queued/failed retry state.
  try {
    const saved = await getCommonsPeople(slug, options);
    const person = saved?.people.find(person => person.invitation?.id === invitationId);
    await autoSendTravelerInvitation(person, deliveryAttemptId, () => processInvitationDelivery(deliveryAttemptId, origin ?? commonsSiteOrigin()));
  } catch { /* The next read returns the actual saved delivery state. */ }
}

export async function addAuthenticatedCommonsPerson(slug: string, input: unknown, origin?: string) {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  try {
    const result = await addCommonsPerson(slug, input, { ...options, queueDelivery: true });
    if (result.invitationId && result.deliveryAttemptId) await deliverNewTravelerInvitation(slug, result.invitationId, result.deliveryAttemptId, options, origin);
  } catch (error) {
    throwSetupAccessError(error);
  }
  return loadAuthenticatedCommonsPeople(slug);
}

export async function inviteAuthenticatedManagedTraveler(slug: string, personId: string, input: unknown, origin?: string) {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  try {
    const result = await inviteManagedTraveler(slug, personId, input, { ...options, queueDelivery: true });
    if (result.deliveryAttemptId) await deliverNewTravelerInvitation(slug, result.invitationId, result.deliveryAttemptId, options, origin);
  }
  catch (error) { throwSetupAccessError(error); }
  return loadAuthenticatedCommonsPeople(slug);
}

export async function updateAuthenticatedCommonsInvitation(slug: string, invitationId: string, input: unknown) {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  try {
    await updateCommonsPendingInvitation(slug, invitationId, input, options);
  } catch (error) {
    throwSetupAccessError(error);
  }
  return loadAuthenticatedCommonsPeople(slug);
}

export async function revokeAuthenticatedCommonsInvitation(slug: string, invitationId: string) {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  try {
    await revokeCommonsInvitation(slug, invitationId, options);
  } catch (error) {
    throwSetupAccessError(error);
  }
  return loadAuthenticatedCommonsPeople(slug);
}

export async function copyAuthenticatedCommonsInvitationLink(slug: string, invitationId: string, origin: string) {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  const result = await getCommonsInvitationLink(slug, invitationId, options);
  return InvitationLinkSchema.parse({
    invitationId: result.invitationId,
    url: `${origin}/join/${result.token}`,
    expiresAt: result.expiresAt,
  });
}

export async function rotateAuthenticatedCommonsInvitationLink(slug: string, invitationId: string, origin: string) {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  const result = await rotateCommonsInvitationLink(slug, invitationId, options);
  return InvitationLinkSchema.parse({
    invitationId: result.invitationId,
    url: `${origin}/join/${result.token}`,
    expiresAt: result.expiresAt,
  });
}

export async function blockAuthenticatedCommonsMemberRemoval(slug: string, personId: string) {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  return blockCommonsMemberRemoval(slug, personId, options);
}

export async function updateAuthenticatedCommonsMemberRole(slug: string, personId: string, input: unknown) {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  try {
    await updateCommonsMemberRole(slug, personId, input, options);
  } catch (error) {
    throwSetupAccessError(error);
  }
  return loadAuthenticatedCommonsPeople(slug);
}

export async function processInvitationDelivery(deliveryAttemptId: string | null, origin: string) {
  const url = databaseUrl();
  if (!url) throw new Error("Commons database persistence is not configured.");
  const invitation = await leaseInvitationDeliveryAttempt(deliveryAttemptId, url);
  if (!invitation) return null;
  try {
    const context = await getInvitationEntryContext(invitation.token, url);
    if (!context) throw new Error("Invitation unavailable.");
    const recipientEmail = context.acceptedAuthUserId
      ? await getSupabaseAuthUserEmail(context.acceptedAuthUserId) : invitation.recipientEmail;
    const joinPath = invitationReturnPath(invitation.token, invitation.returnPollPublicId);
    let entry = invitation.authenticationEntry;
    if (!entry) {
      const proof = await createPasswordlessEmailProof(recipientEmail, `${origin}${joinPath}`);
      entry = await cacheInvitationAuthenticationEntry(invitation.deliveryAttemptId, invitation.leaseAttempt,
        sealInvitationEmailProof({ ...proof, token: invitation.token, tokenVersion: invitation.tokenVersion, email: recipientEmail }), url);
    }
    const entryUrl = new URL(joinPath, origin);
    entryUrl.searchParams.set("entry", entry);
    const tripUrl = entryUrl.toString();
    const rendered = context.status === "accepted"
      ? renderCommonsAuthenticationEmail({ email: recipientEmail, signInUrl: tripUrl, intent: "invited" })
      : renderCommonsInvitationEmail({
      recipientName: invitation.recipientName,
      recipientEmail,
      inviterName: invitation.inviterName,
      tripName: invitation.tripName,
      tripDates: invitationDates(invitation.startsOn, invitation.endsOn),
      tripLocation: invitation.locationName ?? "Location to be decided",
      tripUrl,
      personalMessage: invitation.message ?? undefined,
    });
    if (!await revalidateInvitationDeliveryAttempt(invitation.deliveryAttemptId, invitation.leaseAttempt, url)) {
      return InvitationDeliveryActionSchema.parse({ invitationId: invitation.invitationId, deliveryState: "failed", deliveryErrorCode: "invitation_unavailable" });
    }
    const result = await sendEmail({
      ...rendered,
      to: recipientEmail,
      idempotencyKey: `commons-invite-delivery-${invitation.deliveryAttemptId}`,
    });
    await completeInvitationDeliveryAttempt(
      invitation.deliveryAttemptId,
      { sent: true, providerMessageId: result.id, leaseAttempt: invitation.leaseAttempt },
      url,
    );
    return InvitationDeliveryActionSchema.parse({
      invitationId: invitation.invitationId,
      deliveryState: "sent",
      deliveryErrorCode: null,
    });
  } catch (error) {
    const errorCode = error instanceof EmailDeliveryError ? error.code : "delivery_failed";
    await completeInvitationDeliveryAttempt(
      invitation.deliveryAttemptId,
      { sent: false, errorCode, leaseAttempt: invitation.leaseAttempt },
      url,
    );
    return InvitationDeliveryActionSchema.parse({
      invitationId: invitation.invitationId,
      deliveryState: "failed",
      deliveryErrorCode: errorCode,
    });
  }
}

export async function sendAuthenticatedCommonsInvitation(slug: string, invitationId: string, origin: string) {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  const [queued] = await queueCommonsInvitationDeliveries(slug, invitationId, options);
  if (!queued) throw new Error("That invitation could not be queued.");
  return processInvitationDelivery(queued.deliveryAttemptId, origin);
}

export async function sendAuthenticatedCommonsInvitations(slug: string, origin: string) {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  let queued;
  try {
    queued = await queueCommonsInvitationDeliveries(slug, null, options);
  } catch (error) {
    throwSetupAccessError(error);
  }
  const deliveries = await Promise.all(queued.map(async (invitation) => {
    const delivery = await processInvitationDelivery(invitation.deliveryAttemptId, origin);
    return {
      invitationId: invitation.invitationId,
      recipientName: invitation.recipientName,
      recipientEmail: invitation.recipientEmail,
      deliveryState: delivery?.deliveryState === "sent" ? "sent" as const : "failed" as const,
      token: delivery?.deliveryState === "sent" ? undefined : invitation.token,
    };
  }));
  return SendSetupInvitationsResultSchema.parse({ deliveries });
}

export async function completeAuthenticatedCommonsSetup(slug: string) {
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  try {
    await completeCommonsSetupWithoutSharing(slug, options);
  } catch (error) {
    throwSetupAccessError(error);
  }
}

function throwSetupAccessError(error: unknown): never {
  if (error instanceof Error && error.message === "Only an organizer can change trip setup.") {
    throw new CommonsMembershipRequiredError();
  }
  throw error;
}

export async function loadInvitationPreview(token: string) {
  const url = databaseUrl();
  if (!url) return null;
  return getCommonsInvitationPreview(token, url);
}

export async function claimAuthenticatedInvitation(token: string) {
  const url = databaseUrl();
  if (!url) throw new Error("Commons database persistence is not configured.");
  const identity = await authenticatedIdentity();
  if (!identity) throw new CommonsAuthenticationRequiredError();
  const supabase = await createSupabaseServerClient();
  const {data, error} = await supabase.auth.getUser();
  if (error || !data.user || data.user.id !== identity.authUserId) throw new CommonsAuthenticationRequiredError();
  return claimCommonsInvitation(token, {
    ...identity,
    email: data.user.email_confirmed_at ? data.user.email : undefined,
  }, url);
}

export async function getCurrentCommonsIdentity() {
  if (!isSupabaseAuthConfigured()) return null;
  return getCommonsAuthIdentity();
}

function initialsForName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return `${parts[0]![0] ?? ""}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : parts[0]![1] ?? ""}`.toUpperCase();
}

export async function getCurrentAccountInitials(identity: CommonsAuthIdentity | null) {
  if (!identity) return "";
  const url = databaseUrl();
  if (url) {
    try {
      const profile = await findPersonProfileForAuthUser(identity.authUserId, url);
      if (profile?.displayName) return initialsForName(profile.displayName);
    } catch {
      // Account chrome can fall back to the email even if profile lookup is unavailable.
    }
  }
  const localPart = identity.email?.split("@")[0] ?? "";
  const emailParts = localPart.split(/[._+-]+/).filter(Boolean);
  if (emailParts.length > 1) {
    return `${emailParts[0]![0] ?? ""}${emailParts.at(-1)?.[0] ?? ""}`.toUpperCase();
  }
  return localPart.slice(0, 2).toUpperCase() || "ME";
}

/** Resolves the authenticated participant before private intake context is assembled. */
export async function authenticatedConfirmationIntakeOptions() {
  const options = await databaseOptions();
  if (!options) throw new CommonsAuthenticationRequiredError();
  return options;
}

export async function persistMoneySettings(slug: string, input: unknown) {
  if (getCommonsDataMode(slug) === "demo") {
    throw new Error("Demo target budgets stay on this device.");
  }
  const options = await databaseOptions();
  if (!options) throw new Error("Commons database persistence is not configured.");
  const snapshot = await updateCommonsMoneySettings(slug, input, options);
  if (!snapshot) throw new CommonsMembershipRequiredError();
  return snapshot;
}
