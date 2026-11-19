import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { CoordinatorErrorCode, CoordinatorTurnInterruption } from "@commons/contracts";
import { createDatabase } from "./client";
import { isCommonsId } from "./commons-identifier";
import type { CommandTransaction } from "./event-command";
import { commons, coordinatorTurnExecutions, coordinatorTurns } from "./schema";
import { lifecycleOf, type TurnRow } from "./coordinator-turn-lifecycle";

/*
 * Conversation durability A2 (docs/releases/2026-10-19/CONVERSATION-DURABILITY-BUILD-PLAN.md): acceptance, execution and observation are separate.
 *
 * Acceptance writes the pending turn and one `coordinator_turn_executions` row in the same transaction (beginCoordinatorTurn with `durable`). An
 * executor in any process claims the row under a finite lease and a fresh claim token; every executor write is fenced by that token, and the turn's own
 * attempt guard still decides the commit. Recovery follows one rule: an attempt proven not to have reached a provider may be claimed again (bounded); an
 * attempt that may have reached one is interrupted, never replayed. Observation reads the turn and this row's progress; it calls no model.
 *
 * This module never authorizes trip actions. The worker credential that claims a row only lets it process; the turn service re-checks the owner's
 * membership, role and versions through the ordinary repositories at execution and at commit.
 */

export type CoordinatorTurnExecutionStatus = "queued" | "running" | "completed" | "interrupted" | "cancelled";
export const COORDINATOR_TURN_NOTIFY_CHANNEL = "commons_coordinator_turns";
export const TURN_EXECUTION_LEASE_MS = 30_000;
/** How long accepted work may wait for an executor before it is reported as interrupted instead of left "working". */
export const TURN_EXECUTION_MAX_QUEUE_MS = 60_000;
/** Claims of one attempt that never reached a provider (each ended by a lost executor) before it is interrupted. */
export const TURN_EXECUTION_MAX_CLAIMS = 3;
/** The turn's own lease stays this far beyond the execution lease, so a lookup never fails a turn whose executor is alive. */
const TURN_LEASE_MARGIN_MS = 15_000;

export const TurnExecutionInputSchema = z.object({
  v: z.literal(1),
  /** The validated command exactly as accepted (already fingerprinted on the turn). */
  command: z.record(z.string(), z.unknown()),
  /** Facts the admitting request derived from verified authentication; the executor re-checks what it can and never widens them. */
  admission: z.object({
    authUserId: z.string().max(200).nullable(),
    operator: z.boolean(), reserve: z.boolean(), itineraryGeneration: z.boolean(),
    provisionalTitle: z.string().max(200),
  }).strict(),
}).strict();
export type TurnExecutionInput = z.infer<typeof TurnExecutionInputSchema>;

export type TurnExecutionClaim = {
  turnId: string; attempt: number; commandId: string; tripId: string; actorPersonId: string;
  token: string; workerId: string; leaseExpiresAt: Date; input: TurnExecutionInput; claims: number;
};

type Options = { databaseUrl?: string };

let tablePresent: boolean | null = null;
/** Code from this change may run against a database that predates the additive migration; then there is simply no execution row. */
async function executionsTablePresent(tx: CommandTransaction) {
  if (tablePresent) return true;
  const [row] = await tx.execute<{ present: boolean }>(sql`select to_regclass('public.coordinator_turn_executions') is not null as present`);
  tablePresent = Boolean(row?.present);
  return tablePresent;
}

/** Inserted by beginCoordinatorTurn in the accepting transaction. The NOTIFY is delivered only if that transaction commits. */
export async function insertTurnExecutionInTransaction(tx: CommandTransaction, input: { turnId: string; attempt: number; tripId: string; actorPersonId: string; commandId: string; execution: TurnExecutionInput; now: Date }) {
  const execution = TurnExecutionInputSchema.parse(input.execution);
  await tx.insert(coordinatorTurnExecutions).values({ turnId: input.turnId, attempt: input.attempt, commonsId: input.tripId, ownerPersonId: input.actorPersonId,
    commandId: input.commandId, status: "queued", input: execution, createdAt: input.now, updatedAt: input.now });
  await tx.execute(sql`select pg_notify(${COORDINATOR_TURN_NOTIFY_CHANNEL}, ${input.turnId})`);
}

/** Ends the open execution row of an attempt that just ended some other way (Stop, lease expiry). Input and progress are cleared. */
export async function closeTurnExecutionInTransaction(tx: CommandTransaction, turnId: string, attempt: number, status: "cancelled" | "interrupted", disposition: string, now: Date) {
  if (!await executionsTablePresent(tx)) return;
  await tx.update(coordinatorTurnExecutions).set({ status, disposition, input: null, progress: null, claimToken: null, leaseExpiresAt: null, finishedAt: now, updatedAt: now })
    .where(and(eq(coordinatorTurnExecutions.turnId, turnId), eq(coordinatorTurnExecutions.attempt, attempt), inArray(coordinatorTurnExecutions.status, ["queued", "running"])));
}

/**
 * Inside a turn-repository transaction that already holds the turn row lock: is `token` the current claim for this attempt? Locks the execution row so a
 * concurrent claim cannot slip between this check and the commit. Sample expiry after acquiring the lock, not before waiting for it.
 * A turn admitted without durable execution has no row and passes only without a token.
 */
export async function turnExecutionClaimIsCurrentInTransaction(tx: CommandTransaction, turnId: string, attempt: number, token: string | undefined) {
  if (!await executionsTablePresent(tx)) return token === undefined;
  const [row] = await tx.select({ status: coordinatorTurnExecutions.status, claimToken: coordinatorTurnExecutions.claimToken, leaseExpiresAt: coordinatorTurnExecutions.leaseExpiresAt }).from(coordinatorTurnExecutions)
    .where(and(eq(coordinatorTurnExecutions.turnId, turnId), eq(coordinatorTurnExecutions.attempt, attempt))).for("update");
  if (token === undefined) return !row || row.status !== "running";
  return Boolean(row && row.status === "running" && row.claimToken === token && row.leaseExpiresAt && row.leaseExpiresAt.getTime() > Date.now());
}

export async function finishTurnExecutionInTransaction(tx: CommandTransaction, turnId: string, attempt: number, status: "completed" | "interrupted", disposition: string, now: Date) {
  if (!await executionsTablePresent(tx)) return;
  await tx.update(coordinatorTurnExecutions).set({ status, disposition, input: null, progress: null, claimToken: null, leaseExpiresAt: null, finishedAt: now, updatedAt: now })
    .where(and(eq(coordinatorTurnExecutions.turnId, turnId), eq(coordinatorTurnExecutions.attempt, attempt), inArray(coordinatorTurnExecutions.status, ["queued", "running"])));
}

export type TurnExecutionHooks = {
  /** Supplied by the turn repository (it owns lifecycle writes): fail the locked pending attempt with an interruption marker. */
  interrupt: (tx: CommandTransaction, row: TurnRow, attempt: number, reason: CoordinatorTurnInterruption["reason"], errorCode: CoordinatorErrorCode, now: Date) => Promise<unknown>;
  /** Move the locked pending attempt's lease to at least `until`. */
  extendLease: (tx: CommandTransaction, row: TurnRow, attempt: number, until: Date) => Promise<unknown>;
};

export type ClaimOutcome =
  | { kind: "idle" }
  | { kind: "claimed"; claim: TurnExecutionClaim }
  | { kind: "settled"; turnId: string; attempt: number; disposition: "turn_finished" | "provider_started" | "claims_exhausted" | "queue_expired" | "processing_stopped" | "invalid_input" };

/**
 * Claims the oldest open execution: a queued one, or a running one whose executor's lease expired. One transaction, `FOR UPDATE SKIP LOCKED`, so
 * concurrent executors never take the same row. Before claiming it applies the recovery rule and settles anything that must not run.
 */
export async function claimCoordinatorTurnExecution(hooks: TurnExecutionHooks, options: Options & { workerId: string; now?: Date; leaseMs?: number; maxQueueMs?: number; maxClaims?: number; processingStopped?: boolean }): Promise<ClaimOutcome> {
  const now = options.now ?? new Date(), leaseMs = options.leaseMs ?? TURN_EXECUTION_LEASE_MS;
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      // Lock order matches Stop, commit, renewal and lease expiry: the turn row first, then its execution row. Candidates are read without a lock;
      // a turn or row another transaction holds is skipped, never waited on.
      const open = or(eq(coordinatorTurnExecutions.status, "queued"), and(eq(coordinatorTurnExecutions.status, "running"), lte(coordinatorTurnExecutions.leaseExpiresAt, now)));
      const candidates = await tx.select({ turnId: coordinatorTurnExecutions.turnId, attempt: coordinatorTurnExecutions.attempt }).from(coordinatorTurnExecutions)
        .where(open).orderBy(asc(coordinatorTurnExecutions.createdAt)).limit(5);
      let turn: TurnRow | undefined, row: typeof coordinatorTurnExecutions.$inferSelect | undefined;
      for (const candidate of candidates) {
        [turn] = await tx.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, candidate.turnId)).for("update", { skipLocked: true });
        if (!turn) continue;
        [row] = await tx.select().from(coordinatorTurnExecutions).where(and(eq(coordinatorTurnExecutions.turnId, candidate.turnId), eq(coordinatorTurnExecutions.attempt, candidate.attempt), open)).for("update", { skipLocked: true });
        if (row) break;
      }
      if (!row) return { kind: "idle" as const };
      const settle = async (status: "cancelled" | "interrupted", disposition: Extract<ClaimOutcome, { kind: "settled" }>["disposition"]) => {
        await finishOrClose(tx, row!.turnId, row!.attempt, status, disposition, now);
        return { kind: "settled" as const, turnId: row!.turnId, attempt: row!.attempt, disposition };
      };
      const life = turn ? lifecycleOf(turn) : null;
      if (!turn || !life || life.status !== "pending" || life.attempt !== row.attempt) return settle(row.status === "running" ? "interrupted" : "cancelled", "turn_finished");
      const interrupt = async (reason: CoordinatorTurnInterruption["reason"], disposition: Extract<ClaimOutcome, { kind: "settled" }>["disposition"]) => {
        await hooks.interrupt(tx, turn, row.attempt, reason, "internal_error", now);
        return settle("interrupted", disposition);
      };
      if (options.processingStopped) return interrupt("processing_stopped", "processing_stopped");
      // The previous executor was lost after it may have reached a provider: report it, never repurchase or replay the side effects.
      if (row.status === "running" && row.providerStartedAt) return interrupt("provider_started", "provider_started");
      if (row.claims >= (options.maxClaims ?? TURN_EXECUTION_MAX_CLAIMS)) return interrupt("lease_expired", "claims_exhausted");
      if (row.status === "queued" && now.getTime() - row.createdAt.getTime() > (options.maxQueueMs ?? TURN_EXECUTION_MAX_QUEUE_MS)) return interrupt("lease_expired", "queue_expired");
      const parsed = TurnExecutionInputSchema.safeParse(row.input);
      if (!parsed.success) return interrupt("lease_expired", "invalid_input");
      const token = randomUUID(), leaseExpiresAt = new Date(now.getTime() + leaseMs);
      await tx.update(coordinatorTurnExecutions).set({ status: "running", claimToken: token, claimedBy: options.workerId.slice(0, 120), claims: row.claims + 1, leaseExpiresAt, updatedAt: now })
        .where(and(eq(coordinatorTurnExecutions.turnId, row.turnId), eq(coordinatorTurnExecutions.attempt, row.attempt)));
      await hooks.extendLease(tx, turn, row.attempt, new Date(leaseExpiresAt.getTime() + TURN_LEASE_MARGIN_MS));
      return { kind: "claimed" as const, claim: { turnId: row.turnId, attempt: row.attempt, commandId: row.commandId, tripId: row.commonsId, actorPersonId: row.ownerPersonId,
        token, workerId: options.workerId, leaseExpiresAt, input: parsed.data, claims: row.claims + 1 } };
    });
  } finally { await database.close(); }
}

async function finishOrClose(tx: CommandTransaction, turnId: string, attempt: number, status: "cancelled" | "interrupted", disposition: string, now: Date) {
  await closeTurnExecutionInTransaction(tx, turnId, attempt, status, disposition, now);
}

/**
 * Renews this executor's lease (and the turn's). False when the claim is no longer current: another executor took it, the attempt was stopped or
 * finished, or the lease already expired. The executor must then stop; anything it still tries to save is refused at commit.
 */
export async function renewCoordinatorTurnExecution(hooks: Pick<TurnExecutionHooks, "extendLease">, claim: Pick<TurnExecutionClaim, "turnId" | "attempt" | "token">, options: Options & { now?: Date; leaseMs?: number } = {}) {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [turn] = await tx.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, claim.turnId)).for("update");
      const [row] = await tx.select().from(coordinatorTurnExecutions).where(and(eq(coordinatorTurnExecutions.turnId, claim.turnId), eq(coordinatorTurnExecutions.attempt, claim.attempt))).for("update");
      // A delayed lock acquisition must not renew a lease that expired while this request waited.
      const now = options.now ?? new Date(), leaseExpiresAt = new Date(now.getTime() + (options.leaseMs ?? TURN_EXECUTION_LEASE_MS));
      if (!turn || !row || row.status !== "running" || row.claimToken !== claim.token || !row.leaseExpiresAt || row.leaseExpiresAt <= now) return false;
      const life = lifecycleOf(turn);
      if (life.status !== "pending" || life.attempt !== claim.attempt) { await closeTurnExecutionInTransaction(tx, claim.turnId, claim.attempt, "cancelled", "turn_finished", now); return false; }
      await tx.update(coordinatorTurnExecutions).set({ leaseExpiresAt, updatedAt: now }).where(and(eq(coordinatorTurnExecutions.turnId, claim.turnId), eq(coordinatorTurnExecutions.attempt, claim.attempt)));
      await hooks.extendLease(tx, turn, claim.attempt, new Date(leaseExpiresAt.getTime() + TURN_LEASE_MARGIN_MS));
      return true;
    });
  } finally { await database.close(); }
}

/**
 * Committed before the executor starts work that may reach a provider (context assembly is the last step before dispatch). From then on a lost attempt
 * is interrupted, not reclaimed. Conservative on purpose: a deterministic reply is also marked, because "proven not started" is the only reclaim rule.
 */
export async function markCoordinatorTurnProviderStarted(claim: Pick<TurnExecutionClaim, "turnId" | "attempt" | "token">, options: Options & { now?: Date } = {}) {
  const now = options.now ?? new Date();
  const database = createDatabase(options.databaseUrl);
  try {
    const updated = await database.db.update(coordinatorTurnExecutions).set({ providerStartedAt: sql`coalesce(${coordinatorTurnExecutions.providerStartedAt}, ${now.toISOString()}::timestamptz)`, updatedAt: now })
      .where(and(eq(coordinatorTurnExecutions.turnId, claim.turnId), eq(coordinatorTurnExecutions.attempt, claim.attempt), eq(coordinatorTurnExecutions.status, "running"), eq(coordinatorTurnExecutions.claimToken, claim.token),
        gt(coordinatorTurnExecutions.leaseExpiresAt, options.now ?? sql`clock_timestamp()`)))
      .returning({ turnId: coordinatorTurnExecutions.turnId });
    return updated.length === 1;
  } finally { await database.close(); }
}

/** Phase and guarded reply-so-far for observers. Throttled by the caller; fenced by the claim token; cleared when the attempt ends. */
export async function recordCoordinatorTurnProgress(claim: Pick<TurnExecutionClaim, "turnId" | "attempt" | "token">, progress: { phase: string | null; text: string | null; seq: number }, options: Options & { now?: Date } = {}) {
  const database = createDatabase(options.databaseUrl);
  try {
    await database.db.update(coordinatorTurnExecutions).set({ progress: { phase: progress.phase?.slice(0, 40) ?? null, text: progress.text?.slice(0, 4000) ?? null, seq: progress.seq }, updatedAt: options.now ?? new Date() })
      .where(and(eq(coordinatorTurnExecutions.turnId, claim.turnId), eq(coordinatorTurnExecutions.attempt, claim.attempt), eq(coordinatorTurnExecutions.status, "running"), eq(coordinatorTurnExecutions.claimToken, claim.token),
        gt(coordinatorTurnExecutions.leaseExpiresAt, options.now ?? sql`clock_timestamp()`)));
  } finally { await database.close(); }
}

/**
 * Author-scoped observation for the stream route: the current attempt's execution status and progress. Plain reads, no locks, no model. Membership is
 * re-checked by the caller's ordinary turn lookup, which it performs alongside this.
 */
export async function readCoordinatorTurnExecution(identifier: string, commandId: string, options: Options & { actorPersonId: string }) {
  z.string().uuid().parse(commandId);
  const database = createDatabase(options.databaseUrl);
  try {
    const [event] = await database.db.select({ id: commons.id }).from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).limit(1);
    if (!event) return null;
    const [turn] = await database.db.select({ id: coordinatorTurns.id, workspace: coordinatorTurns.workspace, createdAt: coordinatorTurns.createdAt }).from(coordinatorTurns)
      .where(and(eq(coordinatorTurns.commonsId, event.id), eq(coordinatorTurns.ownerPersonId, options.actorPersonId), eq(coordinatorTurns.commandId, commandId))).limit(1);
    if (!turn) return null;
    const attempt = lifecycleOf(turn).attempt;
    const [row] = await database.db.select({ status: coordinatorTurnExecutions.status, progress: coordinatorTurnExecutions.progress, claims: coordinatorTurnExecutions.claims, providerStartedAt: coordinatorTurnExecutions.providerStartedAt })
      .from(coordinatorTurnExecutions).where(and(eq(coordinatorTurnExecutions.turnId, turn.id), eq(coordinatorTurnExecutions.attempt, attempt))).limit(1);
    return row ? { attempt, status: row.status as CoordinatorTurnExecutionStatus, progress: row.progress ?? null, claims: row.claims, providerStarted: Boolean(row.providerStartedAt) } : null;
  } finally { await database.close(); }
}

/** Open work for health reporting: how many rows wait or run, and the oldest queued age. Bounded by the partial open index. */
export async function coordinatorTurnQueueState(options: Options & { now?: Date } = {}) {
  const now = options.now ?? new Date();
  const database = createDatabase(options.databaseUrl);
  try {
    const [row] = await database.db.select({
      queued: sql<number>`count(*) filter (where ${coordinatorTurnExecutions.status} = 'queued')::int`,
      running: sql<number>`count(*) filter (where ${coordinatorTurnExecutions.status} = 'running')::int`,
      oldestQueued: sql<Date | null>`min(${coordinatorTurnExecutions.createdAt}) filter (where ${coordinatorTurnExecutions.status} = 'queued')`,
    }).from(coordinatorTurnExecutions).where(inArray(coordinatorTurnExecutions.status, ["queued", "running"]));
    const oldest = row?.oldestQueued ? new Date(row.oldestQueued) : null;
    return { queued: row?.queued ?? 0, running: row?.running ?? 0, oldestQueuedMs: oldest ? now.getTime() - oldest.getTime() : null };
  } finally { await database.close(); }
}

/** The auth identity currently linked to the turn's owner. The runner refuses an execution whose admitting identity no longer matches. */
export async function readTurnOwnerAuthUserId(personId: string, options: Options = {}) {
  const database = createDatabase(options.databaseUrl);
  try {
    const [row] = await database.db.execute<{ auth_user_id: string | null }>(sql`select auth_user_id from public.people where id = ${personId} limit 1`);
    return row ? row.auth_user_id ?? null : undefined;
  } finally { await database.close(); }
}
