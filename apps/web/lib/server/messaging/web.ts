import { z } from "zod";
import {
  enrollPersonInTrip, enrollmentStatus, getCommonsSnapshot, intakeByReviewToken, membershipAttendance, MessagingEnrollmentError, personAuth, tripInfo, tripTextingFunded, verifiedPhoneFor, withdrawFromTrip, type BookingIntakeRow, type EnrolledTrip,
} from "@commons/database";
import { SMS_CONSENT_WORDING, bookingSummaryLines, sharingLine } from "@commons/domain";
import { authenticatedConfirmationIntakeOptions } from "../commons";
import { approveIntake, declineIntake, hashReviewToken, runIntake, type IntakeOutcome } from "./booking";
import { dbOptions, messagingDeps, type MessagingDeps } from "./core";
import { dispatchOutbox } from "./dispatch";
import { testNumberFor } from "./in-app-provider";
import { queueWelcome } from "./planner";
import { CommonsMembershipRequiredError } from "../commons-access-errors";

/*
 * The web side of messaging: turning texts on for one trip (the only place consent is created), and the secure review page that is the
 * fallback for pictures, PDFs and anything that is better checked on a screen. Identity always comes from the signed-in session, never the URL.
 * A review link is an address, not a credential: it works only for the signed-in person who owns that intake.
 */
export const EnrollmentRequestSchema = z.object({ phone: z.string().trim().min(7).max(24).optional(), consent: z.literal(true) });

export const SMS_CONSENT_TEXT = (tripName: string) => `Text with Commons. I agree to get texts from Commons about ${tripName} at this number. Message and data rates may apply. Reply STOP to opt out at any time. You can use the trip on the web without texting.`;

export async function readEnrollment(slug: string) {
  const options = await authenticatedConfirmationIntakeOptions();
  const snapshot = await getCommonsSnapshot(slug, options);
  if (!snapshot) throw new CommonsMembershipRequiredError();
  const status = await enrollmentStatus(options.actorPersonId, snapshot.commons.id, { databaseUrl: options.databaseUrl });
  const verifiedPhone = await verifiedPhoneFor(options.actorPersonId, { databaseUrl: options.databaseUrl });
  const funded = await tripTextingFunded(snapshot.commons.id, { databaseUrl: options.databaseUrl });
  return { tripName: snapshot.commons.name, funded, consentText: SMS_CONSENT_TEXT(snapshot.commons.name), wording: SMS_CONSENT_WORDING, verifiedPhone, suggestedPhone: testNumberFor(options.actorPersonId), ...status };
}

export async function enroll(slug: string, raw: unknown): Promise<{ ok: true; welcomeQueued: boolean } | { ok: false; code: MessagingEnrollmentError["code"]; message: string }> {
  const input = EnrollmentRequestSchema.parse(raw);
  const options = await authenticatedConfirmationIntakeOptions();
  const snapshot = await getCommonsSnapshot(slug, options);
  if (!snapshot) throw new CommonsMembershipRequiredError();
  const deps = await messagingDeps(); // no provider, no consent: texting is not offered until it can work
  const e164 = input.phone ?? await verifiedPhoneFor(options.actorPersonId, dbOptions(deps));
  if (!e164) return { ok: false, code: "number_not_verified", message: "Confirm your mobile number first." };
  try { await enrollPersonInTrip({ personId: options.actorPersonId, commonsId: snapshot.commons.id, e164, wording: SMS_CONSENT_WORDING }, dbOptions(deps)); }
  catch (error) { if (error instanceof MessagingEnrollmentError) return { ok: false, code: error.code, message: error.message }; throw error; }
  const auth = await personAuth(options.actorPersonId, dbOptions(deps));
  const welcome = await queueWelcome(deps, { id: options.actorPersonId, name: auth?.displayName ?? "" }, snapshot.commons.id);
  await dispatchOutbox(deps);
  return { ok: true, welcomeQueued: Boolean(welcome) };
}

export async function withdraw(slug: string) {
  const options = await authenticatedConfirmationIntakeOptions();
  const snapshot = await getCommonsSnapshot(slug, options);
  if (!snapshot) throw new CommonsMembershipRequiredError();
  await withdrawFromTrip({ personId: options.actorPersonId, commonsId: snapshot.commons.id, reason: "web_withdrawal" }, { databaseUrl: options.databaseUrl });
}

// ---- Secure review ----------------------------------------------------------------------------------------------------------------------------------

async function ownIntake(token: string) {
  const options = await authenticatedConfirmationIntakeOptions();
  const intake = await intakeByReviewToken(hashReviewToken(token), { databaseUrl: options.databaseUrl });
  // The same not-found for a wrong token, someone else's intake and an expired link: a guess learns nothing.
  if (!intake || intake.personId !== options.actorPersonId) return null;
  const now = (await messagingDeps()).now();
  return { options, intake, expired: Boolean(intake.reviewExpiresAt && intake.reviewExpiresAt <= now) };
}

export type ReviewView = {
  tripName: string; tripSlug: string; status: BookingIntakeRow["status"]; version: number; classification: BookingIntakeRow["classification"]; lines: string[]; uncertain: string[]; sharing: string | null;
  confirmationCode: string | null; canApprove: boolean; canAddSource: boolean; expired: boolean;
};

export async function readReview(token: string): Promise<ReviewView | null> {
  const found = await ownIntake(token);
  if (!found) return null;
  const { intake, options } = found;
  const trip = await tripInfo(intake.commonsId, { databaseUrl: options.databaseUrl });
  if (!trip) return null;
  return {
    tripName: trip.name, tripSlug: trip.slug, status: intake.status, version: intake.version, classification: intake.classification,
    lines: intake.draft ? bookingSummaryLines(intake.draft) : [], uncertain: intake.uncertainty, sharing: intake.draft ? sharingLine(intake.draft) : null,
    confirmationCode: intake.draft?.confirmationCode ?? null,
    canApprove: intake.status === "awaiting_review" && !found.expired, canAddSource: !["saved"].includes(intake.status) && !found.expired, expired: found.expired,
  };
}

async function tripFor(deps: MessagingDeps, intake: BookingIntakeRow): Promise<EnrolledTrip> {
  const trip = await tripInfo(intake.commonsId, dbOptions(deps));
  if (!trip) throw new CommonsMembershipRequiredError();
  const membership = await membershipAttendance(intake.personId, intake.commonsId, dbOptions(deps));
  return { ...trip, role: membership?.role ?? "member", membershipId: membership?.id ?? "", funded: await tripTextingFunded(intake.commonsId, dbOptions(deps)) };
}

export const ReviewActionSchema = z.object({ action: z.enum(["approve", "decline"]), version: z.number().int().positive() });
/** Approving on the web binds to the version the person was looking at. If the summary changed since, nothing is saved. */
export async function actOnReview(token: string, raw: unknown) {
  const input = ReviewActionSchema.parse(raw), found = await ownIntake(token);
  if (!found || found.expired) return null;
  const deps = await messagingDeps({ allowNoProvider: true });
  const person = { id: found.options.actorPersonId, name: (await personAuth(found.options.actorPersonId, dbOptions(deps)))?.displayName ?? "" };
  const trip = await tripFor(deps, found.intake);
  if (input.action === "decline") return { ok: await declineIntake(deps, person, found.intake.id, input.version), result: "declined" as const };
  const outcome = await approveIntake(deps, person, trip, found.intake.id, input.version, "web");
  return outcome.ok ? { ok: true as const, result: outcome.result } : { ok: false as const, reason: outcome.reason };
}

export const ReviewTextSchema = z.object({ text: z.string().trim().min(10).max(20_000) });
/** Add the booking details to this review: pasted text or a file. Starts a new version, so any earlier approval no longer applies. */
export async function addReviewSource(token: string, source: { text: string } | { bytes: Uint8Array; mimeType: string; fileName: string }): Promise<IntakeOutcome | null> {
  const found = await ownIntake(token);
  if (!found || found.expired || found.intake.status === "saved") return null;
  const deps = await messagingDeps({ allowNoProvider: true });
  const person = { id: found.options.actorPersonId, name: "" };
  const trip = await tripFor(deps, found.intake);
  return runIntake(deps, person, trip, "text" in source ? { kind: "text", text: source.text } : { kind: "file", ...source }, { intakeId: found.intake.id });
}

