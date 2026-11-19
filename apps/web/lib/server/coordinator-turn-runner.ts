import { hostname } from "node:os";
import { TurnCommandSchema, type TurnPhase } from "@commons/contracts";
import {
  claimCoordinatorTurnExecution, coordinatorTurnQueueState, failCoordinatorTurn, markCoordinatorTurnProviderStarted, readTurnOwnerAuthUserId,
  recordCoordinatorTurnProgress, recordCoordinatorTurnRunnerHeartbeat, renewCoordinatorTurnExecution, turnExecutionHooks, TURN_EXECUTION_LEASE_MS,
  CoordinatorTurnError, type TurnExecutionClaim,
} from "@commons/database";
import { coordinatorErrorCode } from "./coordinator-errors";
import { runCoordinatorTurn, type CoordinatorTurnDependencies } from "./coordinator-turn-service";
import { runAsTurnPrincipal } from "./turn-principal";
import { resolveTripCapabilities } from "./trip-capabilities";

/*
 * Conversation durability A2: the executor for durably accepted organizer turns. It runs in its own process (scripts/coordinator-turn-runner.ts locally;
 * a protected, unscheduled internal route is prepared for hosted review), claims one execution at a time under a finite renewable lease, and runs the
 * ordinary turn service as the turn's stored owner. It never reads a cookie, a browser request or a caller-supplied actor.
 *
 * Bounded: at most `concurrency` turns at once, `batch` claims per invocation, and a 30-second renewable lease. Recovery runs inside claiming (see
 * claimCoordinatorTurnExecution): undispatched or never-started work is claimed again a bounded number of times; anything that may have reached a
 * provider is interrupted and left for a person to retry. Lookup, heartbeat and recovery make no model calls.
 */

export type RunnerOptions = {
  databaseUrl: string;
  workerId?: string;
  leaseMs?: number; renewMs?: number; maxQueueMs?: number;
  processingStopped?: boolean;
  /** Re-verifies the admitting auth user's email with the provider. Absent (or failing): email-gated features stay off for that execution. */
  resolveVerifiedEmail?: (authUserId: string) => Promise<string | null>;
  /** Provider/test seams forwarded to the turn service (fetcher, infer, deadlines). Never identity. */
  dependencies?: Partial<Pick<CoordinatorTurnDependencies, "fetcher" | "infer" | "inferItinerary" | "research" | "deadlines" | "now" | "steering" | "readExcerpt" | "traceFactory">>;
  /** Observation for evidence: fixed fields only. */
  observe?: (event: RunnerEvent) => void;
};
export type RunnerEvent = { kind: "claimed" | "settled" | "finished" | "lost" | "error"; turnId: string; attempt: number; claims?: number; disposition?: string; status?: string; ms?: number; workerId: string };

export function defaultRunnerId() { return `${hostname().slice(0, 60)}:${process.pid}`; }

/** Claims and runs at most one execution. Returns what happened, for the loop and for tests. */
export async function runOneCoordinatorTurn(options: RunnerOptions): Promise<{ kind: "idle" } | { kind: "settled"; turnId: string; disposition: string } | { kind: "ran"; turnId: string; status: string }> {
  const workerId = options.workerId ?? defaultRunnerId(), databaseUrl = options.databaseUrl;
  await recordCoordinatorTurnRunnerHeartbeat(databaseUrl);
  const outcome = await claimCoordinatorTurnExecution(turnExecutionHooks, { databaseUrl, workerId, ...(options.leaseMs ? { leaseMs: options.leaseMs } : {}), ...(options.maxQueueMs ? { maxQueueMs: options.maxQueueMs } : {}), processingStopped: Boolean(options.processingStopped) });
  if (outcome.kind === "idle") return outcome;
  if (outcome.kind === "settled") { options.observe?.({ kind: "settled", turnId: outcome.turnId, attempt: outcome.attempt, disposition: outcome.disposition, workerId }); return { kind: "settled", turnId: outcome.turnId, disposition: outcome.disposition }; }
  const claim = outcome.claim, started = Date.now();
  options.observe?.({ kind: "claimed", turnId: claim.turnId, attempt: claim.attempt, claims: claim.claims, workerId });
  const status = await executeClaim(claim, options, workerId);
  options.observe?.({ kind: "finished", turnId: claim.turnId, attempt: claim.attempt, status, ms: Date.now() - started, workerId });
  return { kind: "ran", turnId: claim.turnId, status };
}

async function executeClaim(claim: TurnExecutionClaim, options: RunnerOptions, workerId: string): Promise<string> {
  const databaseUrl = options.databaseUrl, leaseMs = options.leaseMs ?? TURN_EXECUTION_LEASE_MS;
  const token = { turnId: claim.turnId, attempt: claim.attempt, token: claim.token };
  const ownerOptions = { databaseUrl, actorPersonId: claim.actorPersonId };
  const failClaim = async (error: unknown) => {
    const code = coordinatorErrorCode(error);
    try { await failCoordinatorTurn(claim.tripId, { turnId: claim.turnId, commandId: claim.commandId, attempt: claim.attempt, errorCode: code === "invalid_request" || code === "internal_error" ? "provider_failed" : code, execution: { token: claim.token } }, ownerOptions); }
    catch { /* The lease bounds it: an unrenewed attempt is interrupted by the next claim or a lookup. */ }
    return "failed";
  };
  const command = TurnCommandSchema.safeParse(claim.input.command);
  if (!command.success) return failClaim(new Error("invalid stored command"));
  // Free beta: work admitted while the trip had Coordinator capability never runs after it lost it (trip-capabilities.ts).
  if (!(await resolveTripCapabilities(claim.tripId)).coordinator) return failClaim(new CoordinatorTurnError("unsupported_capability"));
  // The identity the admitting request verified must still be the one linked to this person.
  const admitted = claim.input.admission.authUserId, linked = await readTurnOwnerAuthUserId(claim.actorPersonId, { databaseUrl });
  if (linked === undefined || (admitted !== null && linked !== admitted)) return failClaim(new CoordinatorTurnError("membership_lost"));
  let verifiedEmail: string | null = null;
  if (admitted && options.resolveVerifiedEmail) { try { verifiedEmail = await options.resolveVerifiedEmail(admitted); } catch { verifiedEmail = null; } }

  const lost = new AbortController();
  let renewing = false;
  const renewMs = Math.max(250, options.renewMs ?? Math.floor(leaseMs / 3));
  const renewal = setInterval(() => {
    if (renewing || lost.signal.aborted) return;
    renewing = true;
    renewCoordinatorTurnExecution(turnExecutionHooks, token, { databaseUrl, leaseMs })
      .then(current => { if (!current) { lost.abort(); options.observe?.({ kind: "lost", turnId: claim.turnId, attempt: claim.attempt, workerId }); } }, () => undefined)
      .finally(() => { renewing = false; });
  }, renewMs);
  // Progress for observers: every phase, and reply text at most every 250ms.
  let seq = 0, phase: TurnPhase | null = null, text: string | null = null, lastText = 0, pending: ReturnType<typeof setTimeout> | undefined;
  const flush = () => { seq += 1; void recordCoordinatorTurnProgress(token, { phase, text, seq }, { databaseUrl }).catch(() => undefined); lastText = Date.now(); };
  try {
    const result = await runAsTurnPrincipal({ kind: "durable_turn", actorPersonId: claim.actorPersonId, tripId: claim.tripId, turnId: claim.turnId, attempt: claim.attempt, authUserId: admitted, verifiedEmail },
      () => runCoordinatorTurn(claim.tripId, command.data, {
        ...options.dependencies,
        // A lost claim (stopped elsewhere, taken over) ends the work here; its commit would be refused anyway.
        stopSignal: lost.signal,
        durable: { mode: "execute", claim: token, admission: claim.input.admission, onProviderStart: () => markCoordinatorTurnProviderStarted(token, { databaseUrl }) },
        onPhase: next => { phase = next; clearTimeout(pending); flush(); },
        onReplyDelta: next => { text = next; clearTimeout(pending); if (Date.now() - lastText >= 250) flush(); else pending = setTimeout(flush, 250); },
      }));
    return result.status;
  } catch (error) {
    return failClaim(error);
  } finally { clearInterval(renewal); clearTimeout(pending); }
}

/**
 * The bounded loop for a runner process: `concurrency` lanes, each claiming one turn at a time, woken by NOTIFY or every `pollMs` when idle, until
 * `signal` aborts. In-flight turns finish first (each is bounded by its own deadlines). Health is the heartbeat each claim attempt writes.
 */
export async function runCoordinatorTurnLoop(options: RunnerOptions & { concurrency?: number; pollMs?: number; signal: AbortSignal; wake?: (listener: () => void) => () => void }) {
  const concurrency = Math.min(Math.max(options.concurrency ?? 2, 1), 8), pollMs = Math.max(100, options.pollMs ?? 1000);
  const sleepers = new Set<() => void>();
  const unsubscribe = options.wake?.(() => { for (const wake of [...sleepers]) wake(); });
  const sleep = () => new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); sleepers.delete(done); resolve(); };
    const timer = setTimeout(done, pollMs);
    sleepers.add(done);
    options.signal.addEventListener("abort", done, { once: true });
  });
  const lane = async () => {
    while (!options.signal.aborted) {
      let idle = true;
      try { idle = (await runOneCoordinatorTurn(options)).kind === "idle"; }
      catch (error) { options.observe?.({ kind: "error", turnId: "", attempt: 0, disposition: error instanceof Error ? error.name : "error", workerId: options.workerId ?? defaultRunnerId() }); }
      if (idle && !options.signal.aborted) await sleep();
    }
  };
  try { await Promise.all(Array.from({ length: concurrency }, lane)); }
  finally { unsubscribe?.(); }
}

export { coordinatorTurnQueueState };
