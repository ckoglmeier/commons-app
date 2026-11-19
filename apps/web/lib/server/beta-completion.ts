import "server-only";
import { after } from "next/server";
import { ZodError } from "zod";
import {
  admitTripUsage, attributionSummary, BetaError, completePartnerInquiry, createPartnerInquiry, createPaymentReport, dismissPaymentReport,
  findOrClaimPersonForAuthIdentity, findTripIdBySlug, getTripRecap, leasePartnerInquiry, listOperatorFailures, listPartnerInquiriesForOperator, listPaymentReports,
  loadSuccessorSource, operatorStates, recordAttribution, recordOperatorAction, recordPaymentReportReceipt, requeueOperatorNotificationDelivery,
  requeuePartnerInquiry, saveTripRecap, setTripUsageControl, tripUsageSummary, type UsageKind,
} from "@commons/database";
import { tripIsNewExperience } from "@commons/database";
import { sendEmail } from "@/lib/email/resend";
import { betaFeatureEnabled, type BetaFeature } from "@/lib/beta/flags";
import { sanitizeEntry, validSubjectKey, type AttributionEventName } from "@/lib/beta/attribution";
import { deliverInquiry, INQUIRY_LIMITS } from "@/lib/beta/inquiry";
import { SUCCESSOR_ATTRIBUTION, buildSuccessorDraft, SuccessorSelectionError, SuccessorSelectionSchema } from "@/lib/beta/successor";
import { gateTripUsage, usageDefaults } from "@/lib/beta/usage";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "./commons-access-errors";
import { authenticatedCommonsRepositoryOptions, loadCommonsSnapshot } from "./commons";
import { createAuthenticatedEventDraft, updateAuthenticatedEventDraft, updateAuthenticatedEventDraftPeople } from "./event-creation";
import { eventCreationErrorResponse } from "./event-creation-response";
import { CommonsOperatorRequiredError, requireCommonsOperator } from "./operator";
import { messagingHealth, requeueFailedOutbound } from "@commons/database";
import { commonsDatabaseUrl, readCommonsRuntimeEnvironment, requireCommonsDatabaseUrl } from "./runtime-environment";

/** Thrown when a beta route is reached with its flag (or kill switch) off. Routes answer 404, as if the route did not exist. */
export class BetaDisabledError extends Error { constructor() { super("Not found."); this.name = "BetaDisabledError"; } }

export function assertBeta(feature: BetaFeature) {
  if (!betaFeatureEnabled(feature, readCommonsRuntimeEnvironment())) throw new BetaDisabledError();
}

const STATUS: Record<BetaError["code"], number> = { not_found: 404, not_authorized: 403, ledger_closed: 409, invalid: 400, conflict: 409, already_resolved: 409 };

/** Maps every failure to a bounded, non-leaking response. Database and provider detail is never returned. */
export function betaErrorResponse(error: unknown) {
  if (error instanceof BetaDisabledError) return Response.json({ error: "Not found." }, { status: 404 });
  if (error instanceof CommonsAuthenticationRequiredError) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (error instanceof CommonsMembershipRequiredError) return Response.json({ error: "You aren't on this trip." }, { status: 403 });
  if (error instanceof CommonsOperatorRequiredError) return Response.json({ error: "Not found." }, { status: 404 });
  if (error instanceof BetaError) return Response.json({ error: error.message, code: error.code }, { status: STATUS[error.code] });
  if (error instanceof SuccessorSelectionError) return Response.json({ error: error.message }, { status: 400 });
  if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: "Check the details and try again." }, { status: 400 });
  return null;
}

/* ---------------------------------------------------------------- money completion */

const repositoryOptions = authenticatedCommonsRepositoryOptions;

export async function loadPaymentReports(slug: string) {
  assertBeta("payment_reports");
  return listPaymentReports(slug, await repositoryOptions());
}
export async function reportPayment(slug: string, input: unknown) {
  assertBeta("payment_reports");
  const body = input as { commandId?: string; toPersonId?: string; currency?: string; amountCents?: number; note?: string | null };
  if (!body || typeof body.commandId !== "string" || typeof body.toPersonId !== "string" || typeof body.currency !== "string" || typeof body.amountCents !== "number") throw new BetaError("invalid", "Enter who you paid, the amount and the currency.");
  return createPaymentReport(slug, { commandId: body.commandId, toPersonId: body.toPersonId, currency: body.currency.toUpperCase(), amountCents: body.amountCents, note: body.note ?? null }, await repositoryOptions());
}
export async function resolvePaymentReport(slug: string, reportId: string, input: unknown) {
  assertBeta("payment_reports");
  const body = input as { action?: string; occurredOn?: string };
  const options = await repositoryOptions();
  if (body?.action === "dismiss") return { report: await dismissPaymentReport(slug, reportId, options), snapshot: null };
  if (body?.action === "record" && typeof body.occurredOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.occurredOn)) {
    const report = await recordPaymentReportReceipt(slug, reportId, { occurredOn: body.occurredOn }, options);
    // The refreshed ledger lets the page show the recorded payment and the new balances without a reload.
    return { report, snapshot: await loadCommonsSnapshot(slug) };
  }
  throw new BetaError("invalid", "Choose to record or dismiss this report.");
}

export async function loadRecap(slug: string) { assertBeta("recap"); return getTripRecap(slug, await repositoryOptions()); }
export async function writeRecap(slug: string, input: unknown) {
  assertBeta("recap");
  const body = input as { expectedVersion?: number; summary?: string; approvedMomentIds?: string[]; share?: boolean };
  if (typeof body?.expectedVersion !== "number" || typeof body.summary !== "string" || !Array.isArray(body.approvedMomentIds) || typeof body.share !== "boolean") throw new BetaError("invalid", "The recap is incomplete.");
  return saveTripRecap(slug, { expectedVersion: body.expectedVersion, summary: body.summary, approvedMomentIds: body.approvedMomentIds.filter(id => typeof id === "string"), share: body.share }, await repositoryOptions());
}

/* ---------------------------------------------------------------- successor draft (BR-08) */

export async function loadSuccessorChoices(slug: string) {
  assertBeta("successor");
  const { tripId: _tripId, ...source } = await loadSuccessorSource(slug, await repositoryOptions());
  void _tripId;
  return source;
}

/**
 * Creates the successor through the existing creation path: a prior-trip draft (which applies the same access rules as /new), then the
 * selected structure, then the people choice. Nothing is invited, charged or approved; the person lands on /new to review the draft.
 */
export async function createSuccessorDraft(slug: string, input: unknown) {
  assertBeta("successor");
  const selection = SuccessorSelectionSchema.parse(input);
  const options = await repositoryOptions();
  const source = await loadSuccessorSource(slug, options);
  const plan = buildSuccessorDraft({ tripName: source.tripName, locationName: source.locationName, activities: source.activities, stays: source.stays }, selection);
  const timezone = String((input as { timezone?: unknown })?.timezone ?? "America/Denver");
  let draft = await createAuthenticatedEventDraft({ sourceKind: "prior_event", sourceEventId: source.tripId, timezone });
  draft = await updateAuthenticatedEventDraft(draft.id, { expectedVersion: draft.version, proposedName: plan.proposedName, startsOn: null, endsOn: null, locationName: plan.locationName, brief: plan.brief });
  if (!plan.includePeople) draft = await updateAuthenticatedEventDraftPeople(draft.id, { expectedVersion: draft.version, people: [] });
  await recordBetaAttribution("traveler_to_organizer", SUCCESSOR_ATTRIBUTION, source.tripId);
  await recordBetaAttribution("draft_started", SUCCESSOR_ATTRIBUTION, draft.id);
  return { draftId: draft.id as string, path: `/new/?draft=${draft.id}` };
}

export { eventCreationErrorResponse };

/* ---------------------------------------------------------------- partner inquiries (BR-09) */

export function inquiryRoute() {
  const route = readCommonsRuntimeEnvironment().COMMONS_PARTNER_INQUIRY_ROUTE_EMAIL;
  return route ? route.trim().toLowerCase() : null;
}

export function inquiryDeliveryDeps() {
  const databaseUrl = requireCommonsDatabaseUrl();
  return {
    lease: async (id: string) => leasePartnerInquiry(id, { databaseUrl }),
    complete: (id: string, attempt: number, result: { sent: true; providerMessageId: string } | { sent: false; errorCode: string }) => completePartnerInquiry(id, attempt, result, { databaseUrl }),
    send: ({ to, subject, text, html, idempotencyKey }: { to: string; subject: string; text: string; html: string; idempotencyKey: string }) => sendEmail({ to, subject, text, html, idempotencyKey }),
  };
}

export const inquiryRouteDeps = {
  enabled: () => betaFeatureEnabled("inquiry", readCommonsRuntimeEnvironment()),
  routeEmail: inquiryRoute,
  salt: () => readCommonsRuntimeEnvironment().COMMONS_INVITATION_TOKEN_KEY ?? "commons-local-inquiry-salt",
  save: (input: Parameters<typeof createPartnerInquiry>[0]) => createPartnerInquiry(input, INQUIRY_LIMITS, { databaseUrl: requireCommonsDatabaseUrl() }),
  // The saved row is the source of truth. A failed or deferred send never turns a stored inquiry into an error for the sender.
  afterSave: (id: string) => {
    try { after(async () => { try { await deliverInquiry(id, inquiryDeliveryDeps()); } catch { console.error("Partner inquiry delivery deferred to operator retry."); } }); }
    catch { console.error("Partner inquiry scheduling deferred to operator retry."); }
  },
};

/* ---------------------------------------------------------------- attribution and usage */

/** Never throws and never blocks the action it describes. A no-op with the flag off. */
export async function recordBetaAttribution(event: AttributionEventName, entry: { entryKind?: unknown; entryRef?: unknown }, subjectKey: string) {
  try {
    if (!betaFeatureEnabled("attribution", readCommonsRuntimeEnvironment()) || !validSubjectKey(subjectKey)) return false;
    const url = commonsDatabaseUrl();
    if (!url) return false;
    const { entryKind, entryRef } = sanitizeEntry(entry.entryKind, entry.entryRef);
    return await recordAttribution({ event, entryKind, entryRef, subjectKey }, { databaseUrl: url });
  } catch { return false; }
}

/** `const gate = await gateUsage(tripId, "extraction_call", { dedupeKey })`; only continue when `gate.proceed`. A no-op with the flag off. */
export async function gateUsage(tripId: string, kind: UsageKind, options: { units?: number; costMicros?: number | null; dedupeKey?: string | null } = {}) {
  const env = readCommonsRuntimeEnvironment();
  const url = commonsDatabaseUrl();
  if (!url) return { proceed: true as const, recorded: false };
  // Bounds belong to the new experience; existing trips keep working as they do today.
  if (!await tripIsNewExperience(tripId, url).catch(() => false)) return { proceed: true as const, recorded: false };
  return gateTripUsage((trip, input) => admitTripUsage(trip, input, { databaseUrl: url }), tripId, kind, { ...options, env });
}

/* ---------------------------------------------------------------- operator tools (BR-10) */

async function operatorContext() {
  assertBeta("operator_tools");
  const identity = await requireCommonsOperator();
  const databaseUrl = requireCommonsDatabaseUrl();
  const operatorPersonId = await findOrClaimPersonForAuthIdentity(identity, databaseUrl);
  if (!operatorPersonId) throw new CommonsOperatorRequiredError();
  return { databaseUrl, operatorPersonId };
}

/**
 * Interface for other failure sources (for example SMS delivery tables owned by another workstream). A source lists items using only
 * classification, counts and times; it never returns message bodies, recipients or file names. `retry` must be idempotent.
 */
export type OperatorFailureSource = {
  kind: string;
  list: () => Promise<{ id: string; summary: string; detail: string; attempts: number; occurredAt: Date; retryable: boolean }[]>;
  retry?: (id: string) => Promise<boolean>;
};

export async function loadBetaOperatorOverview() {
  const { databaseUrl } = await operatorContext();
  return betaOperatorOverview(databaseUrl);
}

/** The overview without the sign-in check, so it can be tested directly. Only `loadBetaOperatorOverview` is reachable from a page. */
export async function betaOperatorOverview(databaseUrl: string) {
  const options = { databaseUrl };
  const [inquiries, failures] = await Promise.all([listPartnerInquiriesForOperator(options), listOperatorFailures(options)]);
  const inquiryStates = await operatorStates("partner_inquiry", inquiries.map(row => row.id), options);
  const failureStates = {
    partner_inquiry: await operatorStates("partner_inquiry", failures.filter(f => f.kind === "partner_inquiry").map(f => f.id), options),
    notification: await operatorStates("notification", failures.filter(f => f.kind === "notification").map(f => f.id), options),
    intake: await operatorStates("intake", failures.filter(f => f.kind === "intake").map(f => f.id), options),
  };
  const attribution = await attributionSummary(new Date(Date.now() - 30 * 86_400_000), options);
  const environment = readCommonsRuntimeEnvironment();
  return {
    routeConfigured: Boolean(inquiryRoute()),
    inquiries: inquiries.map(row => ({ ...row, state: inquiryStates.get(row.id)?.state ?? "open" as const })),
    failures: failures.map(item => ({ ...item, state: failureStates[item.kind].get(item.id)?.state ?? "open" as const })),
    messaging: await messagingHealth(options),
    attribution,
    killSwitches: Object.entries(environment).filter(([key, value]) => (key.startsWith("COMMONS_BETA_KILL_") || key.startsWith("COMMONS_BETA_USAGE_OFF_")) && value === "true").map(([key]) => key),
  };
}

export async function markOperatorItem(input: { kind: "partner_inquiry" | "notification" | "intake"; id: string; action: "reviewed" | "resolved" | "reopened"; note?: string }) {
  const { databaseUrl, operatorPersonId } = await operatorContext();
  return recordOperatorAction({ operatorPersonId, subjectKind: input.kind, subjectId: input.id, action: input.action, note: input.note }, { databaseUrl });
}

/** A retry is recorded first, then performed. It only re-queues what has not been delivered, and delivery itself is idempotent. */
export async function retryOperatorItem(input: { kind: "partner_inquiry" | "notification"; id: string }) {
  const { databaseUrl, operatorPersonId } = await operatorContext();
  const options = { databaseUrl };
  await recordOperatorAction({ operatorPersonId, subjectKind: input.kind, subjectId: input.id, action: "retry_requested" }, options);
  if (input.kind === "notification") return requeueOperatorNotificationDelivery(input.id, options);
  if (!(await requeuePartnerInquiry(input.id, inquiryRoute(), options))) return false;
  if (inquiryRoute()) await deliverInquiry(input.id, inquiryDeliveryDeps());
  return true;
}

/** Sends a failed text back through every send-time check. Recorded first; nothing is sent blindly. */
export async function retryOperatorMessage(id: string, confirm: { checkedProvider?: boolean } = {}) {
  const { databaseUrl, operatorPersonId } = await operatorContext();
  await recordOperatorAction({ operatorPersonId, subjectKind: "notification", subjectId: id, action: "retry_requested" }, { databaseUrl });
  return requeueFailedOutbound(id, { databaseUrl }, confirm);
}

/** An operator names a trip by its slug. Only the trip's usage counts are returned: no members, content or contact details. */
export async function loadTripUsage(slug: string) {
  const { databaseUrl } = await operatorContext();
  const tripId = await findTripIdBySlug(slug, { databaseUrl });
  if (!tripId) return null;
  return { tripId, rows: await tripUsageSummary(tripId, usageDefaults(readCommonsRuntimeEnvironment()), { databaseUrl }) };
}

export async function changeTripUsageControl(slug: string, kind: UsageKind, patch: { limitUnits: number | null; disabled: boolean }) {
  const { databaseUrl, operatorPersonId } = await operatorContext();
  const tripId = await findTripIdBySlug(slug, { databaseUrl });
  if (!tripId) throw new BetaError("not_found", "No trip has that address.");
  return setTripUsageControl(tripId, kind, patch, operatorPersonId, { databaseUrl });
}
