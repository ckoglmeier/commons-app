import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import { createDatabase } from "./client";
import { addCommonsReimbursement, CommonsRepositoryError } from "./pilot-repository";
import {
    commons,
    itineraryItems,
    memberships,
    moments,
    paymentReports,
    processedCommands,
    stays,
    tripRecaps,
} from "./schema";

/*
 * Beta completion repository. Authorization is decided here from the saved membership, never from the caller's claim.
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
