import "server-only";
import { recordBetaAttribution } from "./beta-completion";
import { deliverBetaApprovalNotice } from "./beta-approval-delivery";
import { betaActivationEnabled } from "@/lib/trip-activation/provider";

import {
  decideEventCreationAccess,
  prepareBetaOrganizerInvite,
  markBetaOrganizerInviteSent,
  listBetaOrganizerInvites,
  revokeBetaOrganizerInvite,
  normalizeBetaInviteEmail,
  findOrClaimPersonForAuthIdentity,
  listOperatorOverview,
  listOperatorTripPayments,
  resolveActivationRefundHold,
  retryActivationFeeExpense,
  queueOperatorInvitationRetry,
  retryOperatorConversationDigest,
  searchOperatorAccounts,
} from "@commons/database";
import { getCommonsAuthIdentity } from "@/lib/supabase/server";
import { getSupabaseAuthUserEmail } from "@/lib/supabase/admin";
import { processInvitationDelivery } from "./commons";
import { assertEmailDeliveryAllowed, sendEmail } from "@/lib/email/resend";
import { renderBetaOrganizerEmail } from "@/lib/email/beta-organizer-email";
import { commonsSiteOrigin } from "./runtime-environment";
import { readCommonsRuntimeEnvironment, requireCommonsDatabaseUrl } from "./runtime-environment";
import { isCommonsOperatorEmail, isCommonsOperatorRequest } from "./operator-accounts";

export class CommonsOperatorRequiredError extends Error {
  constructor() { super("Operator access is required."); this.name = "CommonsOperatorRequiredError"; }
}

export { isCommonsOperatorEmail, isCommonsOperatorRequest };

/** Authentication boundary for operator-only controls that do not need trip data. */
export async function requireCommonsOperator() {
  const identity = await getCommonsAuthIdentity();
  if (!identity?.email || !isCommonsOperatorEmail(identity.email)) throw new CommonsOperatorRequiredError();
  return identity;
}

export function emailDeliveryConfiguration() {
  const environment = readCommonsRuntimeEnvironment();
  const mode = environment.COMMONS_EMAIL_SEND_MODE ?? "disabled";
  const missing = [
    !environment.RESEND_API_KEY ? "RESEND_API_KEY" : null,
    !environment.COMMONS_EMAIL_FROM ? "COMMONS_EMAIL_FROM" : null,
    mode === "disabled" ? "COMMONS_EMAIL_SEND_MODE" : null,
    mode === "allowlist" && !environment.COMMONS_EMAIL_RECIPIENT_ALLOWLIST ? "COMMONS_EMAIL_RECIPIENT_ALLOWLIST" : null,
    !environment.CRON_SECRET ? "CRON_SECRET" : null,
    !environment.NEXT_PUBLIC_SITE_URL ? "NEXT_PUBLIC_SITE_URL" : null,
  ].filter((value): value is string => Boolean(value));
  return {
    configured: missing.length === 0,
    digestsEnabled: environment.COMMONS_CONVERSATION_DIGESTS_ENABLED === "true",
    mode,
    missing,
  };
}

async function operatorOptions() {
  const databaseUrl = requireCommonsDatabaseUrl();
  const identity = await requireCommonsOperator();
  const actorPersonId = await findOrClaimPersonForAuthIdentity(identity, databaseUrl);
  if (!actorPersonId) throw new CommonsOperatorRequiredError();
  return { databaseUrl, actorPersonId };
}

export async function loadOperatorOverview(searchQuery = "") {
  const options = await operatorOptions();
  const overview = await listOperatorOverview(options.databaseUrl);
  const matches = searchQuery.trim().length >= 2
    ? await searchOperatorAccounts(searchQuery, options.databaseUrl)
    : [];
  const accounts = await Promise.all(matches.map(async (row) => {
    let email = row.requesterEmail;
    if (row.authUserId) {
      try { email = await getSupabaseAuthUserEmail(row.authUserId); }
      catch { /* Keep the last known request email when Auth lookup is unavailable. */ }
    }
    return {
      personId: row.personId,
      displayName: row.displayName,
      email,
      accessStatus: row.accessStatus as "requested" | "approved" | "revoked" | null,
    };
  }));
  return { ...overview, accounts, betaInvites: await listBetaOrganizerInvites(options.databaseUrl), email: emailDeliveryConfiguration() };
}

export async function sendOperatorBetaInvite(emailInput: string, message = "") {
  const options = await operatorOptions();
  const email = normalizeBetaInviteEmail(emailInput);
  assertEmailDeliveryAllowed(email);
  if (!emailDeliveryConfiguration().configured) throw new Error("Email delivery is not configured.");
  const invite = await prepareBetaOrganizerInvite(email, options.actorPersonId, options.databaseUrl, message);
  if (invite.revokedAt) return "This invitation was revoked. Use Find an account to restore access after they sign in.";
  if (invite.sentAt) return "An invitation was already sent to this email. No new email was sent.";
  await sendEmail({ ...renderBetaOrganizerEmail(commonsSiteOrigin(), invite.message), to: invite.email, idempotencyKey: `beta-organizer:${invite.id}` });
  await markBetaOrganizerInviteSent(invite.id, options.databaseUrl);
  return `Invitation sent to ${email}. They can sign in with this email to create events.`;
}

export async function revokeOperatorBetaInvite(id: string) {
  const options = await operatorOptions();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid invitation.");
  await revokeBetaOrganizerInvite(id, options.actorPersonId, options.databaseUrl);
}

export async function setOperatorCreationAccess(
  personId: string,
  status: "approved" | "revoked",
  reason?: string,
  requesterEmail?: string,
) {
  const options = await operatorOptions();
  const decision = await decideEventCreationAccess({
    personId,
    status,
    actorPersonId: options.actorPersonId,
    requesterEmail,
    reason,
    ...(betaActivationEnabled() ? { grantsPilotCapabilities: false } : {}),
  }, options.databaseUrl);
  // Delivery is separate from the decision: a failed notice never undoes an approval.
  if (status === "approved" && betaActivationEnabled()) await deliverBetaApprovalNotice(personId, options.databaseUrl).catch(() => undefined);
  // Attribution never holds a person, so an approval with no saved draft to point at isn't counted.
  if (status === "approved" && decision?.resumeDraftId) await recordBetaAttribution("approved", { entryKind: "unknown" }, decision.resumeDraftId);
  return decision;
}

export async function retryOperatorApprovalNotice(personId: string) {
  const options = await operatorOptions();
  return deliverBetaApprovalNotice(personId, options.databaseUrl);
}

export async function loadOperatorTripPayments(page = 0) {
  await requireCommonsOperator();
  return listOperatorTripPayments(requireCommonsDatabaseUrl(), page);
}

export async function resolveOperatorRefundHold(draftId: string, reason: string) {
  const options = await operatorOptions();
  return resolveActivationRefundHold({ draftId, actorPersonId: options.actorPersonId, reason }, options.databaseUrl);
}

export async function retryOperatorFeeExpense(draftId: string) {
  const options = await operatorOptions();
  return retryActivationFeeExpense({ draftId, actorPersonId: options.actorPersonId }, options.databaseUrl);
}

export async function retryOperatorInvitation(invitationId: string, origin: string, reason?: string) {
  const options = await operatorOptions();
  const attempt = await queueOperatorInvitationRetry({ invitationId, actorPersonId: options.actorPersonId, reason }, options.databaseUrl);
  return processInvitationDelivery(attempt.id, origin);
}

export async function retryConversationDigest(deliveryId: string, reason?: string) {
  const options = await operatorOptions();
  return retryOperatorConversationDigest({
    deliveryId,
    actorPersonId: options.actorPersonId,
    reason,
  }, options.databaseUrl);
}
