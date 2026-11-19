import "server-only";
import { betaReworkEnabled } from "@/lib/beta/flags";
import { gateUsage, recordBetaAttribution } from "./beta-completion";
import {
  attachTripCheckout, findOrClaimPersonForAuthIdentity, inviteSavedDraftPeople, readTripActivationStatus, readTripCheckoutBySession,
  tripIdForActivationDraft, recordTripCheckoutEnded, recordTripPaymentProcessing, recordVerifiedTripPayment, recordVerifiedTripRefund, replaceExpiredTripCheckout,
  reserveTripActivation, resolveCommonsTripId, TripActivationError, TripActivationRequiredError,
} from "@commons/database";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getLocalDevelopmentPilotActorId, isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { getCommonsAuthIdentity } from "@/lib/supabase/server";
import {
  ActivationProviderUnavailableError, betaActivationEnabled, createCheckoutSession, interpretProviderEvent, ProviderEvidenceError,
  readActivationProviderConfig, readCheckoutStatus, verifyWebhookSignature,
} from "@/lib/trip-activation/provider";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "./commons-access-errors";
import { commonsDatabaseUrl, commonsSiteOrigin } from "./runtime-environment";
import { sendAuthenticatedCommonsInvitations } from "./commons";

export { betaActivationEnabled };

/** Add first in a route's catch so a gate refusal reaches the person as itself, not as a generic failure. */
export function activationRefusal(error: unknown) {
  if (error instanceof TripActivationRequiredError) return NextResponse.json({ error: error.message, code: error.code, state: error.state }, { status: 409 });
  return null;
}

async function activationOptions() {
  const databaseUrl = commonsDatabaseUrl();
  if (!databaseUrl) throw new Error("Commons database persistence is not configured.");
  if (!isSupabaseAuthConfigured()) {
    const actorPersonId = getLocalDevelopmentPilotActorId();
    if (!actorPersonId) throw new CommonsAuthenticationRequiredError();
    return { databaseUrl, actorPersonId };
  }
  const identity = await getCommonsAuthIdentity();
  if (!identity) throw new CommonsAuthenticationRequiredError();
  const actorPersonId = await findOrClaimPersonForAuthIdentity(identity, databaseUrl);
  if (!actorPersonId) throw new CommonsMembershipRequiredError();
  return { databaseUrl, actorPersonId };
}

export function activationProviderConfig(requestOrigin?: string) {
  return readActivationProviderConfig(process.env, commonsSiteOrigin(requestOrigin));
}

export async function loadTripActivationStatus(target: { draftId: string } | { trip: string }) {
  if (!betaReworkEnabled()) return null;
  const options = await activationOptions();
  if ("trip" in target) {
    const tripId = await resolveCommonsTripId(target.trip, options.databaseUrl);
    return tripId ? readTripActivationStatus({ tripId }, options) : null;
  }
  return readTripActivationStatus(target, options);
}

/** A success redirect is never proof of payment: this only hands out a checkout address. The signed webhook records payment. */
export async function beginTripCheckout(draftId: string, requestOrigin?: string): Promise<{ status: "paid" | "processing" } | { status: "open"; url: string }> {
  if (!betaActivationEnabled()) throw new TripActivationError("not_found", "Checkout isn’t available.");
  const config = activationProviderConfig(requestOrigin);
  if (!config) throw new ActivationProviderUnavailableError();
  const options = await activationOptions();
  const reserved = await reserveTripActivation(draftId, options);
  if (reserved.refundHold) throw new TripActivationRequiredError("refund_hold");
  let payment = reserved.payment;
  if (payment.status === "paid") return { status: "paid" };
  const reference = { draftId, organizerId: options.actorPersonId, attemptId: payment.attemptId };
  if (payment.sessionId && payment.checkoutUrl) {
    const status = await readCheckoutStatus(config, { ...reference, sessionId: payment.sessionId });
    if (status === "open") return { status: "open", url: payment.checkoutUrl };
    if (status === "complete") return { status: "processing" };
    payment = await replaceExpiredTripCheckout(draftId, payment.sessionId, options);
    if (payment.status === "paid") return { status: "paid" };
  }
  const session = await createCheckoutSession(config, { ...reference, attemptId: payment.attemptId });
  await attachTripCheckout(draftId, payment.attemptId, session, options);
  return { status: "open", url: session.url };
}

/** Verified payment evidence is the only way a payment becomes paid. Unverified or mismatched input throws. */
export async function handleProviderWebhook(raw: string, signature: string, requestOrigin?: string) {
  const databaseUrl = commonsDatabaseUrl();
  const config = activationProviderConfig(requestOrigin);
  if (!databaseUrl || !config) throw new ActivationProviderUnavailableError();
  const event = interpretProviderEvent(config, verifyWebhookSignature(config, raw, signature));
  switch (event.kind) {
    case "ignored": return;
    case "checkout_ended": await recordTripCheckoutEnded(event.sessionId, event.failureCode, databaseUrl); return;
    case "refund": await recordVerifiedTripRefund(event, databaseUrl); return;
    default: {
      const payment = await readTripCheckoutBySession(event.sessionId, databaseUrl);
      if (!payment) throw new ProviderEvidenceError("Unknown checkout session.");
      if (payment.draftId !== event.reference.draftId || payment.organizerId !== event.reference.organizerId || payment.attemptId !== event.reference.attemptId) {
        throw new ProviderEvidenceError("Payment does not match this trip checkout.");
      }
      if (event.kind === "payment_processing") await recordTripPaymentProcessing(event.sessionId, databaseUrl);
      else {
        await recordVerifiedTripPayment(event, databaseUrl);
        // One row per draft, so a replayed webhook can't count twice.
        await recordBetaAttribution("paid_activation", { entryKind: "unknown" }, payment.draftId);
        const tripId = await tripIdForActivationDraft(payment.draftId, databaseUrl);
        if (tripId) await gateUsage(tripId, "payment_fee", { units: 1, dedupeKey: `fee:${payment.draftId}` }).catch(() => undefined);
      }
    }
  }
}

const InviteSavedSchema = z.object({ trip: z.string().min(1).max(200) }).strict();

/** Step 4: invite the people saved in setup, once paid. The same retry never creates a second invitation. */
export async function inviteSavedPeopleFromDraft(draftId: string, input: unknown, origin: string) {
  const { trip } = InviteSavedSchema.parse(input);
  const options = await activationOptions();
  const invited = await inviteSavedDraftPeople(draftId, options);
  if (invited.slug !== trip && invited.tripId !== trip) throw new TripActivationError("not_found", "That trip is unavailable.");
  return sendAuthenticatedCommonsInvitations(invited.slug, origin);
}
