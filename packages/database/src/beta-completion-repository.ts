import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { addCommonsReimbursement, CommonsRepositoryError } from "./pilot-repository";
import {
  attributionEvents,
  commons,
  confirmationIntakes,
  feedbackSubmissions,
  itineraryItems,
  memberships,
  moments,
  operatorActions,
  operatorNotificationDeliveries,
  partnerInquiries,
  paymentReports,
  processedCommands,
  stays,
  tripRecaps,
  tripUsageControls,
  tripUsageEvents,
} from "./schema";

/*
 * Beta completion repository (docs/BETA-COMPLETION-STATUS.md). Everything here is reached only through routes that check
 * COMMONS_BETA_REWORK_ENABLED. Authorization is decided here from the saved membership, never from the caller's claim.
 */

type Options = { databaseUrl?: string };
type ActorOptions = Options & { actorPersonId: string };

export class BetaError extends Error {
  constructor(public readonly code:
    | "not_found" | "not_authorized" | "ledger_closed" | "invalid" | "conflict" | "already_resolved",
    message: string) {
    super(message);
    this.name = "BetaError";
  }
}

const NAMESPACE = "commons-beta-completion";
/** A stable UUID derived from a report id, so recording the same report twice replays one reimbursement. */
export function receiptCommandId(reportId: string) {
  const bytes = createHash("sha256").update(`${NAMESPACE}:receipt:${reportId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function withDatabase<T>(options: Options, run: (db: ReturnType<typeof createDatabase>["db"]) => Promise<T>) {
  const database = createDatabase(options.databaseUrl);
  try { return await run(database.db); } finally { await database.close(); }
}

async function memberOf(db: ReturnType<typeof createDatabase>["db"], slug: string, personId: string) {
  const [row] = await db.select({ commonsId: commons.id, closedAt: commons.expensesClosedAt, role: memberships.role, status: memberships.status, currency: commons.currency })
    .from(commons)
    .innerJoin(memberships, and(eq(memberships.commonsId, commons.id), eq(memberships.personId, personId)))
    .where(eq(commons.slug, slug)).limit(1);
  if (!row || row.status !== "active") throw new BetaError("not_authorized", "Only an active member of this trip can do that.");
  return row;
}

/* ---------------------------------------------------------------- payment reports (BR-08) */

export type PaymentReportInput = { commandId: string; toPersonId: string; currency: string; amountCents: number; note?: string | null };

/**
 * "I paid". Saved as a claim; it changes no balance and records no reimbursement. Replaying the same command returns the same report.
 */
export async function createPaymentReport(slug: string, input: PaymentReportInput, options: ActorOptions) {
  if (!/^[A-Z]{3}$/.test(input.currency) || !Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 10_000_000) {
    throw new BetaError("invalid", "Enter the amount and currency you paid.");
  }
  const note = input.note?.trim() ? input.note.trim().slice(0, 200) : null;
  return withDatabase(options, db => db.transaction(async tx => {
    const trip = await memberOf(tx as never, slug, options.actorPersonId);
    if (trip.closedAt) throw new BetaError("ledger_closed", "The ledger is closed. Ask an organizer to reopen it first.");
    if (input.toPersonId === options.actorPersonId) throw new BetaError("invalid", "Choose the person you paid.");
    const [recipient] = await tx.select({ status: memberships.status }).from(memberships)
      .where(and(eq(memberships.commonsId, trip.commonsId), eq(memberships.personId, input.toPersonId))).limit(1);
    if (recipient?.status !== "active") throw new BetaError("invalid", "You can report a payment only to someone on this trip.");
    const [created] = await tx.insert(paymentReports).values({
      commonsId: trip.commonsId, reportedByPersonId: options.actorPersonId, toPersonId: input.toPersonId,
      currency: input.currency, amountCents: input.amountCents, note, commandId: input.commandId,
    }).onConflictDoNothing().returning();
    if (created) return created;
    const [existing] = await tx.select().from(paymentReports).where(and(eq(paymentReports.commonsId, trip.commonsId),
      eq(paymentReports.reportedByPersonId, options.actorPersonId), eq(paymentReports.commandId, input.commandId))).limit(1);
    if (!existing) throw new BetaError("conflict", "That report could not be saved.");
    return existing;
  }));
}

/** Reports the viewer may see: their own, ones naming them as the person paid, and every report for organizers. */
export async function listPaymentReports(slug: string, options: ActorOptions) {
  return withDatabase(options, async db => {
    const trip = await memberOf(db, slug, options.actorPersonId);
    const rows = await db.select().from(paymentReports).where(eq(paymentReports.commonsId, trip.commonsId)).orderBy(desc(paymentReports.createdAt)).limit(200);
    return rows.filter(row => trip.role === "organizer" || row.reportedByPersonId === options.actorPersonId || row.toPersonId === options.actorPersonId);
  });
}

/**
 * Records the receipt for a report. Only the person who was paid, or an organizer, can do this. It creates the ordinary reimbursement through
 * the existing command (so every existing ledger rule, including the closed-ledger block, applies) and links it to the report.
 */
export async function recordPaymentReportReceipt(slug: string, reportId: string, input: { occurredOn: string }, options: ActorOptions) {
  const commandId = receiptCommandId(reportId);
  const { report, trip } = await withDatabase(options, async db => {
    const trip = await memberOf(db, slug, options.actorPersonId);
    const [report] = await db.select().from(paymentReports).where(and(eq(paymentReports.id, reportId), eq(paymentReports.commonsId, trip.commonsId))).limit(1);
    if (!report) throw new BetaError("not_found", "That payment report was not found.");
    if (trip.role !== "organizer" && report.toPersonId !== options.actorPersonId) {
      throw new BetaError("not_authorized", "Only the person who was paid, or an organizer, can record this payment.");
    }
    if (report.status === "dismissed") throw new BetaError("already_resolved", "This report was dismissed.");
    return { report, trip };
  });
  if (report.status === "recorded") return report;
  try {
    await addCommonsReimbursement(slug, {
      commandId, fromPersonId: report.reportedByPersonId, toPersonId: report.toPersonId, currency: report.currency,
      amountCents: report.amountCents, occurredOn: input.occurredOn,
    }, { databaseUrl: options.databaseUrl, actorPersonId: options.actorPersonId });
  } catch (error) {
    if (error instanceof CommonsRepositoryError && error.code === "expense_ledger_closed") throw new BetaError("ledger_closed", "The ledger is closed. Reopen it before recording this payment.");
    throw error;
  }
  return withDatabase(options, db => db.transaction(async tx => {
    const [processed] = await tx.select({ result: processedCommands.result }).from(processedCommands)
      .where(and(eq(processedCommands.commonsId, trip.commonsId), eq(processedCommands.commandId, commandId))).limit(1);
    const reimbursementId = processed && typeof processed.result.reimbursementId === "string" ? processed.result.reimbursementId : null;
    if (!reimbursementId) throw new BetaError("conflict", "The payment was not recorded.");
    const [updated] = await tx.update(paymentReports).set({ status: "recorded", reimbursementId, resolvedAt: new Date(), resolvedByPersonId: options.actorPersonId })
      .where(and(eq(paymentReports.id, reportId), eq(paymentReports.status, "reported"))).returning();
    if (updated) return updated;
    const [current] = await tx.select().from(paymentReports).where(eq(paymentReports.id, reportId)).limit(1);
    if (current?.status === "recorded") return current;
    throw new BetaError("already_resolved", "This report was dismissed.");
  }));
}

/** The person who was paid, an organizer, or the reporter (withdrawing) can dismiss a report. Dismissing records nothing and settles nothing. */
export async function dismissPaymentReport(slug: string, reportId: string, options: ActorOptions) {
  return withDatabase(options, db => db.transaction(async tx => {
    const trip = await memberOf(tx as never, slug, options.actorPersonId);
    const [report] = await tx.select().from(paymentReports).where(and(eq(paymentReports.id, reportId), eq(paymentReports.commonsId, trip.commonsId))).for("update").limit(1);
    if (!report) throw new BetaError("not_found", "That payment report was not found.");
    if (trip.role !== "organizer" && ![report.toPersonId, report.reportedByPersonId].includes(options.actorPersonId)) {
      throw new BetaError("not_authorized", "Only the people involved, or an organizer, can dismiss this report.");
    }
    if (report.status !== "reported") return report;
    const [updated] = await tx.update(paymentReports).set({ status: "dismissed", resolvedAt: new Date(), resolvedByPersonId: options.actorPersonId })
      .where(eq(paymentReports.id, reportId)).returning();
    return updated!;
  }));
}

/* ---------------------------------------------------------------- recap and successor source (BR-08) */

/** What a successor draft may reuse: shared-with-everyone planning titles only. No votes, attendance, bookings, payments, messages or notes. */
export async function loadSuccessorSource(slug: string, options: ActorOptions) {
  return withDatabase(options, async db => {
    const trip = await memberOf(db, slug, options.actorPersonId);
    const [info] = await db.select({ id: commons.id, name: commons.name, locationName: commons.locationName }).from(commons).where(eq(commons.id, trip.commonsId)).limit(1);
    const activities = await db.select({ id: itineraryItems.id, title: itineraryItems.title }).from(itineraryItems)
      .where(and(eq(itineraryItems.commonsId, trip.commonsId), eq(itineraryItems.audience, "everyone"), ne(itineraryItems.status, "cancelled")))
      .orderBy(asc(itineraryItems.title)).limit(40);
    const stayRows = await db.select({ id: stays.id, name: stays.name }).from(stays).where(eq(stays.commonsId, trip.commonsId)).orderBy(asc(stays.name)).limit(20);
    return { tripId: info!.id, tripName: info!.name, locationName: info!.locationName, activities, stays: stayRows };
  });
}

export type RecapView = { status: "none" | "draft" | "shared"; summary: string; version: number; memories: { id: string; caption: string }[]; approvedAt: string | null };

async function recapView(db: ReturnType<typeof createDatabase>["db"], commonsId: string, includeDraft: boolean): Promise<RecapView> {
  const [row] = await db.select().from(tripRecaps).where(eq(tripRecaps.commonsId, commonsId)).limit(1);
  if (!row || (!includeDraft && row.status !== "shared")) return { status: "none", summary: "", version: row?.version ?? 0, memories: [], approvedAt: null };
  const ids = row.approvedMomentIds;
  const rows = ids.length ? await db.select({ id: moments.id, caption: moments.caption }).from(moments).where(and(eq(moments.commonsId, commonsId), inArray(moments.id, ids))) : [];
  const byId = new Map(rows.map(r => [r.id, r.caption]));
  return { status: row.status, summary: row.summary, version: row.version, memories: ids.flatMap(id => byId.has(id) ? [{ id, caption: byId.get(id)! }] : []), approvedAt: row.approvedAt?.toISOString() ?? null };
}

/** Organizers see the draft; everyone else sees only a shared recap. */
export async function getTripRecap(slug: string, options: ActorOptions) {
  return withDatabase(options, async db => {
    const trip = await memberOf(db, slug, options.actorPersonId);
    return recapView(db, trip.commonsId, trip.role === "organizer");
  });
}

export async function saveTripRecap(slug: string, input: { expectedVersion: number; summary: string; approvedMomentIds: string[]; share: boolean }, options: ActorOptions) {
  const summary = input.summary.trim();
  if (summary.length > 1200 || input.approvedMomentIds.length > 24) throw new BetaError("invalid", "The recap is too long.");
  return withDatabase(options, db => db.transaction(async tx => {
    const trip = await memberOf(tx as never, slug, options.actorPersonId);
    if (trip.role !== "organizer") throw new BetaError("not_authorized", "Only an organizer can write the recap.");
    const unique = [...new Set(input.approvedMomentIds)];
    if (unique.length) {
      const [{ n }] = await tx.select({ n: count() }).from(moments).where(and(eq(moments.commonsId, trip.commonsId), inArray(moments.id, unique)));
      if (Number(n) !== unique.length) throw new BetaError("invalid", "Choose memories from this trip’s photos.");
    }
    const [existing] = await tx.select().from(tripRecaps).where(eq(tripRecaps.commonsId, trip.commonsId)).for("update").limit(1);
    const approval = input.share ? { status: "shared" as const, approvedAt: new Date(), approvedByPersonId: options.actorPersonId } : { status: "draft" as const, approvedAt: null, approvedByPersonId: null };
    if (!existing) {
      if (input.expectedVersion !== 0) throw new BetaError("conflict", "The recap changed. Reload and try again.");
      await tx.insert(tripRecaps).values({ commonsId: trip.commonsId, summary, approvedMomentIds: unique, ...approval });
    } else {
      if (existing.version !== input.expectedVersion) throw new BetaError("conflict", "The recap changed. Reload and try again.");
      await tx.update(tripRecaps).set({ summary, approvedMomentIds: unique, ...approval, version: existing.version + 1, updatedAt: new Date() }).where(eq(tripRecaps.id, existing.id));
    }
    return recapView(tx as never, trip.commonsId, true);
  }));
}

/* ---------------------------------------------------------------- partner inquiries (BR-09) */

export type InquiryInput = {
  kind: "dmo" | "travel_assistant"; organization: string; contactName: string; contactEmail: string; website: string | null; region: string | null;
  message: string; sourcePath: string; idempotencyKey: string; clientHash: string; routedTo: string | null;
};
export type InquiryLimits = { perClientPerHour: number; globalPerHour: number };

export function inquiryFingerprint(input: Pick<InquiryInput, "contactEmail" | "message">) {
  return createHash("sha256").update(`${input.contactEmail.trim().toLowerCase()}\n${input.message.trim().toLowerCase().replace(/\s+/g, " ")}`).digest("hex");
}

export type InquiryResult = { status: "created" | "duplicate" | "rate_limited"; id?: string };

/** Stores an inquiry unless it is a duplicate (same idempotency key, or same sender and message within a day) or over a rate limit. */
export async function createPartnerInquiry(input: InquiryInput, limits: InquiryLimits, options: Options, now = new Date()): Promise<InquiryResult> {
  const fingerprint = inquiryFingerprint(input);
  return withDatabase(options, db => db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('partner_inquiries'))`);
    const [byKey] = await tx.select({ id: partnerInquiries.id }).from(partnerInquiries).where(eq(partnerInquiries.idempotencyKey, input.idempotencyKey)).limit(1);
    if (byKey) return { status: "duplicate" as const, id: byKey.id };
    const day = new Date(now.getTime() - 86_400_000), hour = new Date(now.getTime() - 3_600_000);
    const [same] = await tx.select({ id: partnerInquiries.id }).from(partnerInquiries).where(and(eq(partnerInquiries.fingerprint, fingerprint), gte(partnerInquiries.createdAt, day))).limit(1);
    if (same) return { status: "duplicate" as const, id: same.id };
    const [mine] = await tx.select({ n: count() }).from(partnerInquiries).where(and(eq(partnerInquiries.clientHash, input.clientHash), gte(partnerInquiries.createdAt, hour)));
    const [all] = await tx.select({ n: count() }).from(partnerInquiries).where(gte(partnerInquiries.createdAt, hour));
    if (Number(mine!.n) >= limits.perClientPerHour || Number(all!.n) >= limits.globalPerHour) return { status: "rate_limited" as const };
    const [created] = await tx.insert(partnerInquiries).values({
      kind: input.kind, organization: input.organization, contactName: input.contactName, contactEmail: input.contactEmail, website: input.website, region: input.region,
      message: input.message, sourcePath: input.sourcePath, idempotencyKey: input.idempotencyKey, fingerprint, clientHash: input.clientHash,
      routedTo: input.routedTo, deliveryStatus: input.routedTo ? "queued" : "not_routed", createdAt: now,
    }).returning({ id: partnerInquiries.id });
    return { status: "created" as const, id: created!.id };
  }));
}

export const INQUIRY_MAX_ATTEMPTS = 5;

/** Leases one inquiry for a delivery attempt. Returns null when it is already sent, not routed, or being sent. */
export async function leasePartnerInquiry(id: string, options: Options, now = new Date()) {
  return withDatabase(options, async db => {
    const stale = new Date(now.getTime() - 5 * 60_000);
    const [row] = await db.update(partnerInquiries).set({ deliveryStatus: "sending", deliveryAttempts: sql`${partnerInquiries.deliveryAttempts} + 1`, deliveryLastAttemptAt: now })
      .where(and(eq(partnerInquiries.id, id), isNotNull(partnerInquiries.routedTo), lt(partnerInquiries.deliveryAttempts, INQUIRY_MAX_ATTEMPTS),
        or(inArray(partnerInquiries.deliveryStatus, ["queued", "failed"]), and(eq(partnerInquiries.deliveryStatus, "sending"), lt(partnerInquiries.deliveryLastAttemptAt, stale))))).returning();
    return row ?? null;
  });
}

export async function completePartnerInquiry(id: string, attempt: number, result: { sent: true; providerMessageId: string } | { sent: false; errorCode: string }, options: Options, now = new Date()) {
  return withDatabase(options, async db => {
    const patch = result.sent
      ? { deliveryStatus: "sent" as const, deliveredAt: now, providerMessageId: result.providerMessageId, deliveryErrorCode: null }
      : { deliveryStatus: "failed" as const, deliveryErrorCode: result.errorCode.slice(0, 60) };
    const updated = await db.update(partnerInquiries).set(patch).where(and(eq(partnerInquiries.id, id), eq(partnerInquiries.deliveryStatus, "sending"), eq(partnerInquiries.deliveryAttempts, attempt))).returning({ id: partnerInquiries.id });
    return updated.length === 1;
  });
}

/** An operator retry: gives a failed or unrouted inquiry another delivery window. It never resends one that was already sent. */
export async function requeuePartnerInquiry(id: string, routedTo: string | null, options: Options) {
  return withDatabase(options, async db => {
    const rows = await db.update(partnerInquiries).set({ deliveryStatus: routedTo ? "queued" : "not_routed", routedTo, deliveryAttempts: 0, deliveryErrorCode: null })
      .where(and(eq(partnerInquiries.id, id), ne(partnerInquiries.deliveryStatus, "sent"), ne(partnerInquiries.deliveryStatus, "sending"))).returning({ id: partnerInquiries.id });
    return rows.length === 1;
  });
}

/* ---------------------------------------------------------------- attribution (BR-09) */

export type AttributionEvent = "draft_started" | "approved" | "paid_activation" | "traveler_participation" | "traveler_to_organizer";
export type EntryKind = "direct" | "template" | "destination" | "assistant" | "partner" | "recap" | "unknown";

/** Records one funnel step once per subject. Nothing about a person, contact or text is accepted. */
export async function recordAttribution(input: { event: AttributionEvent; entryKind: EntryKind; entryRef?: string | null; subjectKey: string }, options: Options) {
  return withDatabase(options, async db => {
    const rows = await db.insert(attributionEvents).values({ event: input.event, entryKind: input.entryKind, entryRef: input.entryRef ?? null, subjectKey: input.subjectKey })
      .onConflictDoNothing().returning({ id: attributionEvents.id });
    return rows.length === 1;
  });
}

export async function attributionSummary(since: Date, options: Options) {
  return withDatabase(options, async db => db.select({ event: attributionEvents.event, entryKind: attributionEvents.entryKind, total: count() })
    .from(attributionEvents).where(gte(attributionEvents.createdAt, since)).groupBy(attributionEvents.event, attributionEvents.entryKind));
}

/* ---------------------------------------------------------------- per-trip usage (BR-10) */

export type UsageKind = "sms_segment" | "extraction_call" | "model_call" | "map_lookup" | "payment_fee";
export const USAGE_KINDS: UsageKind[] = ["sms_segment", "extraction_call", "model_call", "map_lookup", "payment_fee"];
export const USAGE_WINDOW_DAYS = 30;

export type UsageAdmission = { allowed: true; used: number; limit: number | null } | { allowed: false; reason: "trip_disabled" | "limit_reached"; used: number; limit: number | null };

/**
 * Admits (and records) usage against a rolling window. A per-trip control can raise, lower or disable a kind; otherwise the default bound
 * applies. A null default means measure only. A denied request records nothing, and a replayed dedupe key is admitted without counting again.
 */
export async function admitTripUsage(commonsId: string, input: { kind: UsageKind; units: number; costMicros?: number | null; dedupeKey?: string | null; defaultLimit: number | null }, options: Options, now = new Date()): Promise<UsageAdmission> {
  return withDatabase(options, db => db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`usage:${commonsId}:${input.kind}`}))`);
    const [control] = await tx.select().from(tripUsageControls).where(and(eq(tripUsageControls.commonsId, commonsId), eq(tripUsageControls.kind, input.kind))).limit(1);
    const windowStart = new Date(now.getTime() - USAGE_WINDOW_DAYS * 86_400_000);
    const [usedRow] = await tx.select({ n: sql<number>`coalesce(sum(${tripUsageEvents.units}), 0)::int` }).from(tripUsageEvents)
      .where(and(eq(tripUsageEvents.commonsId, commonsId), eq(tripUsageEvents.kind, input.kind), gte(tripUsageEvents.createdAt, windowStart)));
    const used = Number(usedRow!.n);
    const limit = control?.limitUnits ?? input.defaultLimit;
    if (control?.disabled) return { allowed: false as const, reason: "trip_disabled" as const, used, limit };
    if (input.dedupeKey) {
      const [seen] = await tx.select({ id: tripUsageEvents.id }).from(tripUsageEvents).where(and(eq(tripUsageEvents.commonsId, commonsId), eq(tripUsageEvents.kind, input.kind), eq(tripUsageEvents.dedupeKey, input.dedupeKey))).limit(1);
      if (seen) return { allowed: true as const, used, limit };
    }
    if (limit !== null && used + input.units > limit) return { allowed: false as const, reason: "limit_reached" as const, used, limit };
    await tx.insert(tripUsageEvents).values({ commonsId, kind: input.kind, units: input.units, costMicros: input.costMicros ?? null, dedupeKey: input.dedupeKey ?? null, createdAt: now }).onConflictDoNothing();
    return { allowed: true as const, used: used + input.units, limit };
  }));
}

export async function tripUsageSummary(commonsId: string, defaults: Record<UsageKind, number | null>, options: Options, now = new Date()) {
  return withDatabase(options, async db => {
    const windowStart = new Date(now.getTime() - USAGE_WINDOW_DAYS * 86_400_000);
    const used = await db.select({ kind: tripUsageEvents.kind, units: sql<number>`sum(${tripUsageEvents.units})::int`, cost: sql<number>`coalesce(sum(${tripUsageEvents.costMicros}), 0)::int` })
      .from(tripUsageEvents).where(and(eq(tripUsageEvents.commonsId, commonsId), gte(tripUsageEvents.createdAt, windowStart))).groupBy(tripUsageEvents.kind);
    const controls = await db.select().from(tripUsageControls).where(eq(tripUsageControls.commonsId, commonsId));
    return USAGE_KINDS.map(kind => {
      const control = controls.find(row => row.kind === kind);
      return { kind, used: Number(used.find(row => row.kind === kind)?.units ?? 0), costMicros: Number(used.find(row => row.kind === kind)?.cost ?? 0),
        limit: control?.limitUnits ?? defaults[kind], disabled: control?.disabled ?? false, customized: Boolean(control) };
    });
  });
}

/**
 * Recent feedback volume for spam limits: how many submissions the same trip context and the whole deployment received in the last hour, and
 * whether the same message was already sent from this context in the last ten minutes (returning its id so a double send is one report).
 */
export async function feedbackActivity(input: { commonsSlug: string; message: string }, options: Options, now = new Date()) {
  return withDatabase(options, async db => {
    const hour = new Date(now.getTime() - 3_600_000), window = new Date(now.getTime() - 600_000);
    const [context] = await db.select({ n: count() }).from(feedbackSubmissions).where(and(eq(feedbackSubmissions.commonsSlug, input.commonsSlug), gte(feedbackSubmissions.createdAt, hour)));
    const [all] = await db.select({ n: count() }).from(feedbackSubmissions).where(gte(feedbackSubmissions.createdAt, hour));
    const recent = await db.select({ id: feedbackSubmissions.id, answers: feedbackSubmissions.answers }).from(feedbackSubmissions)
      .where(and(eq(feedbackSubmissions.commonsSlug, input.commonsSlug), gte(feedbackSubmissions.createdAt, window))).orderBy(desc(feedbackSubmissions.createdAt)).limit(30);
    const wanted = input.message.trim().toLowerCase().replace(/\s+/g, " ");
    const duplicate = recent.find(row => String((row.answers as Record<string, unknown>).message ?? "").trim().toLowerCase().replace(/\s+/g, " ") === wanted);
    return { inContext: Number(context!.n), global: Number(all!.n), duplicateId: duplicate?.id ?? null };
  });
}

export async function findTripIdBySlug(slug: string, options: Options) {
  return withDatabase(options, async db => (await db.select({ id: commons.id }).from(commons).where(eq(commons.slug, slug)).limit(1))[0]?.id ?? null);
}

export async function setTripUsageControl(commonsId: string, kind: UsageKind, patch: { limitUnits: number | null; disabled: boolean }, operatorPersonId: string, options: Options) {
  if (patch.limitUnits !== null && (!Number.isInteger(patch.limitUnits) || patch.limitUnits < 0 || patch.limitUnits > 100_000)) throw new BetaError("invalid", "Choose a limit between 0 and 100000.");
  return withDatabase(options, db => db.transaction(async tx => {
    await tx.insert(tripUsageControls).values({ commonsId, kind, limitUnits: patch.limitUnits, disabled: patch.disabled, updatedByPersonId: operatorPersonId })
      .onConflictDoUpdate({ target: [tripUsageControls.commonsId, tripUsageControls.kind], set: { limitUnits: patch.limitUnits, disabled: patch.disabled, updatedByPersonId: operatorPersonId, updatedAt: new Date() } });
    await tx.insert(operatorActions).values({ operatorPersonId, subjectKind: "usage_control", subjectId: `${commonsId}:${kind}`.slice(0, 80), action: "control_changed",
      note: `${patch.disabled ? "disabled" : "enabled"}; limit ${patch.limitUnits ?? "default"}` });
  }));
}

/* ---------------------------------------------------------------- operator actions and failures (BR-10) */

export type OperatorSubject = "partner_inquiry" | "notification" | "invitation" | "digest" | "intake" | "feedback" | "usage_control";
export type OperatorAction = "reviewed" | "resolved" | "reopened" | "retry_requested";
export type OperatorState = "open" | "reviewed" | "resolved";

/** reviewed means someone looked. resolved means the problem is fixed or closed. A retry or reopen puts an item back to open. */
export function operatorStateFor(action: OperatorAction | undefined): OperatorState {
  return action === "resolved" ? "resolved" : action === "reviewed" ? "reviewed" : "open";
}

export async function recordOperatorAction(input: { operatorPersonId: string; subjectKind: OperatorSubject; subjectId: string; action: OperatorAction; note?: string | null }, options: Options) {
  const note = input.note?.trim() ? input.note.trim().slice(0, 300) : null;
  return withDatabase(options, async db => {
    const [row] = await db.insert(operatorActions).values({ operatorPersonId: input.operatorPersonId, subjectKind: input.subjectKind, subjectId: input.subjectId.slice(0, 80), action: input.action, note }).returning();
    return row!;
  });
}

export async function operatorStates(subjectKind: OperatorSubject, ids: string[], options: Options) {
  if (!ids.length) return new Map<string, { state: OperatorState; at: Date }>();
  return withDatabase(options, async db => {
    const rows = await db.select().from(operatorActions).where(and(eq(operatorActions.subjectKind, subjectKind), inArray(operatorActions.subjectId, ids))).orderBy(asc(operatorActions.createdAt));
    const result = new Map<string, { state: OperatorState; at: Date }>();
    for (const row of rows) if (row.action !== "control_changed") result.set(row.subjectId, { state: operatorStateFor(row.action), at: row.createdAt });
    return result;
  });
}

export type FailureItem = {
  kind: "partner_inquiry" | "notification" | "intake";
  id: string;
  summary: string;
  detail: string;
  attempts: number;
  occurredAt: Date;
  retryable: boolean;
};

/**
 * Failures an operator can act on, with only classification, counts and times. No recipient, message body, file name or traveler text is
 * selected. Intake failures are visible but not retryable here: the file is the traveler's private upload, so they re-upload.
 */
export async function listOperatorFailures(options: Options, now = new Date()): Promise<FailureItem[]> {
  return withDatabase(options, async db => {
    const week = new Date(now.getTime() - 7 * 86_400_000);
    const inquiries = await db.select({ id: partnerInquiries.id, kind: partnerInquiries.kind, status: partnerInquiries.deliveryStatus, attempts: partnerInquiries.deliveryAttempts, code: partnerInquiries.deliveryErrorCode, at: partnerInquiries.createdAt })
      .from(partnerInquiries).where(and(inArray(partnerInquiries.deliveryStatus, ["failed", "not_routed"]), gte(partnerInquiries.createdAt, week))).orderBy(desc(partnerInquiries.createdAt)).limit(50);
    const notifications = await db.select({ id: operatorNotificationDeliveries.id, attempts: operatorNotificationDeliveries.attempts, code: operatorNotificationDeliveries.errorCode, at: operatorNotificationDeliveries.createdAt })
      .from(operatorNotificationDeliveries).where(and(eq(operatorNotificationDeliveries.status, "failed"), gte(operatorNotificationDeliveries.createdAt, week))).orderBy(desc(operatorNotificationDeliveries.createdAt)).limit(50);
    const intakes = await db.select({ id: confirmationIntakes.id, kind: confirmationIntakes.kind, at: confirmationIntakes.updatedAt })
      .from(confirmationIntakes).where(and(eq(confirmationIntakes.status, "failed"), gte(confirmationIntakes.updatedAt, week))).orderBy(desc(confirmationIntakes.updatedAt)).limit(50);
    return [
      ...inquiries.map(row => ({ kind: "partner_inquiry" as const, id: row.id, summary: row.kind === "dmo" ? "DMO inquiry" : "Travel assistant inquiry", detail: row.status === "not_routed" ? "No operator address is configured" : `Delivery failed${row.code ? ` · ${row.code.replaceAll("_", " ")}` : ""}`, attempts: row.attempts, occurredAt: row.at, retryable: true })),
      ...notifications.map(row => ({ kind: "notification" as const, id: row.id, summary: "Operator notification", detail: `Delivery failed${row.code ? ` · ${row.code.replaceAll("_", " ")}` : ""}`, attempts: row.attempts, occurredAt: row.at, retryable: true })),
      ...intakes.map(row => ({ kind: "intake" as const, id: row.id, summary: "Booking intake failed", detail: `${String(row.kind).replaceAll("_", " ")} could not be read. The traveler can upload it again.`, attempts: 0, occurredAt: row.at, retryable: false })),
    ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  });
}

/** Makes a failed operator notification eligible again. The worker's idempotency key prevents a second send of the same notification. */
export async function requeueOperatorNotificationDelivery(id: string, options: Options, now = new Date()) {
  return withDatabase(options, async db => {
    const rows = await db.update(operatorNotificationDeliveries).set({ status: "queued", availableAt: now, leaseExpiresAt: null, errorCode: null })
      .where(and(eq(operatorNotificationDeliveries.id, id), eq(operatorNotificationDeliveries.status, "failed"))).returning({ id: operatorNotificationDeliveries.id });
    return rows.length === 1;
  });
}

export async function listPartnerInquiriesForOperator(options: Options, limit = 50) {
  return withDatabase(options, async db => db.select({
    id: partnerInquiries.id, kind: partnerInquiries.kind, organization: partnerInquiries.organization, contactName: partnerInquiries.contactName, contactEmail: partnerInquiries.contactEmail,
    website: partnerInquiries.website, region: partnerInquiries.region, message: partnerInquiries.message, sourcePath: partnerInquiries.sourcePath,
    deliveryStatus: partnerInquiries.deliveryStatus, deliveryAttempts: partnerInquiries.deliveryAttempts, deliveryErrorCode: partnerInquiries.deliveryErrorCode,
    deliveredAt: partnerInquiries.deliveredAt, routedTo: partnerInquiries.routedTo, createdAt: partnerInquiries.createdAt,
  }).from(partnerInquiries).orderBy(desc(partnerInquiries.createdAt)).limit(Math.max(1, Math.min(limit, 200))));
}

export function newAttributionSubjectKey() { return randomUUID(); }
