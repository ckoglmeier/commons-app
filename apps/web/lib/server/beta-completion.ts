import "server-only";
import { ZodError } from "zod";
import {
  BetaError, createPaymentReport, dismissPaymentReport, getTripRecap, listPaymentReports, loadSuccessorSource, recordPaymentReportReceipt, saveTripRecap,
} from "@commons/database";
import { buildSuccessorDraft, SuccessorSelectionError, SuccessorSelectionSchema } from "@/lib/beta/successor";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "./commons-access-errors";
import { authenticatedCommonsRepositoryOptions, loadCommonsSnapshot } from "./commons";
import { createAuthenticatedEventDraft, updateAuthenticatedEventDraft, updateAuthenticatedEventDraftPeople } from "./event-creation";
import { eventCreationErrorResponse } from "./event-creation-response";

const STATUS: Record<BetaError["code"], number> = { not_found: 404, not_authorized: 403, ledger_closed: 409, invalid: 400, conflict: 409, already_resolved: 409 };

/** Maps every failure to a bounded, non-leaking response. Database and provider detail is never returned. */
export function betaErrorResponse(error: unknown) {
  if (error instanceof CommonsAuthenticationRequiredError) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (error instanceof CommonsMembershipRequiredError) return Response.json({ error: "You aren't on this trip." }, { status: 403 });
  if (error instanceof BetaError) return Response.json({ error: error.message, code: error.code }, { status: STATUS[error.code] });
  if (error instanceof SuccessorSelectionError) return Response.json({ error: error.message }, { status: 400 });
  if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: "Check the details and try again." }, { status: 400 });
  return null;
}

/* ---------------------------------------------------------------- money completion */

const repositoryOptions = authenticatedCommonsRepositoryOptions;

export async function loadPaymentReports(slug: string) {
  return listPaymentReports(slug, await repositoryOptions());
}
export async function reportPayment(slug: string, input: unknown) {
  const body = input as { commandId?: string; toPersonId?: string; currency?: string; amountCents?: number; note?: string | null };
  if (!body || typeof body.commandId !== "string" || typeof body.toPersonId !== "string" || typeof body.currency !== "string" || typeof body.amountCents !== "number") throw new BetaError("invalid", "Enter who you paid, the amount and the currency.");
  return createPaymentReport(slug, { commandId: body.commandId, toPersonId: body.toPersonId, currency: body.currency.toUpperCase(), amountCents: body.amountCents, note: body.note ?? null }, await repositoryOptions());
}
export async function resolvePaymentReport(slug: string, reportId: string, input: unknown) {
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

export async function loadRecap(slug: string) { return getTripRecap(slug, await repositoryOptions()); }
export async function writeRecap(slug: string, input: unknown) {
  const body = input as { expectedVersion?: number; summary?: string; approvedMomentIds?: string[]; share?: boolean };
  if (typeof body?.expectedVersion !== "number" || typeof body.summary !== "string" || !Array.isArray(body.approvedMomentIds) || typeof body.share !== "boolean") throw new BetaError("invalid", "The recap is incomplete.");
  return saveTripRecap(slug, { expectedVersion: body.expectedVersion, summary: body.summary, approvedMomentIds: body.approvedMomentIds.filter(id => typeof id === "string"), share: body.share }, await repositoryOptions());
}

/* ---------------------------------------------------------------- successor draft (BR-08) */

export async function loadSuccessorChoices(slug: string) {
  const { tripId: _tripId, ...source } = await loadSuccessorSource(slug, await repositoryOptions());
  void _tripId;
  return source;
}

/**
 * Creates the successor through the existing creation path: a prior-trip draft (which applies the same access rules as /new), then the
 * selected structure, then the people choice. Nothing is invited or charged; the person lands on /new to review the draft.
 */
export async function createSuccessorDraft(slug: string, input: unknown) {
  const selection = SuccessorSelectionSchema.parse(input);
  const options = await repositoryOptions();
  const source = await loadSuccessorSource(slug, options);
  const plan = buildSuccessorDraft({ tripName: source.tripName, locationName: source.locationName, activities: source.activities, stays: source.stays }, selection);
  const timezone = String((input as { timezone?: unknown })?.timezone ?? "America/Denver");
  let draft = await createAuthenticatedEventDraft({ sourceKind: "prior_event", sourceEventId: source.tripId, timezone });
  draft = await updateAuthenticatedEventDraft(draft.id, { expectedVersion: draft.version, proposedName: plan.proposedName, startsOn: null, endsOn: null, locationName: plan.locationName, brief: plan.brief });
  if (!plan.includePeople) draft = await updateAuthenticatedEventDraftPeople(draft.id, { expectedVersion: draft.version, people: [] });
  return { draftId: draft.id as string, path: `/new/?draft=${draft.id}` };
}

export { eventCreationErrorResponse };
