import { after } from "next/server";
import { coordinatorErrorCatalog, TurnCommandSchema, TurnPhaseSchema, type TurnCommand, type TurnStreamEvent } from "@commons/contracts";
import { coordinatorTurnRunnerHealthy, findCoordinatorTurnByCommand, readCoordinatorTurnExecution } from "@commons/database";
import { getCommonsAuthIdentity } from "@/lib/supabase/server";
import { commonsDatabaseUrl, durableCoordinatorTurnsEnabled } from "@/lib/server/runtime-environment";

/** An event before the stream numbers it (distributes over the union, so each variant keeps its own fields). */
type UnnumberedEvent = TurnStreamEvent extends infer Event ? Event extends TurnStreamEvent ? Omit<Event, "commandId" | "seq"> : never : never;
import { coordinatorErrorCode, coordinatorErrorFrom, coordinatorErrorResponse } from "@/lib/server/coordinator-errors";
import { runCoordinatorTurn, turnResultFromRecord, type CoordinatorTurnDependencies } from "@/lib/server/coordinator-turn-service";

/*
 * POST /turns with `Accept: text/event-stream`: the same turn as the JSON route, reported as it happens (docs/COORDINATOR-IMPLEMENTATION-HANDOFF.md §3).
 * The work belongs to the saved command, not to the connection: a client that disconnects does not cancel it, and `after()` keeps it running until it
 * is committed, so a reload finds the finished reply by command id. Only an explicit Stop ends it early.
 */

/**
 * Stops for turns running in THIS server instance, by command id. A Stop that reaches another instance finds nothing here and says so; the turn then
 * finishes normally and is reported as it was saved. Best effort by design: stopping never undoes something already committed.
 */
const running = new Map<string, AbortController>();

export function stopRunningTurn(commandId: string): boolean {
  const controller = running.get(commandId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export const streamHeaders = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // no-transform keeps proxies from compressing (and so buffering) the stream; X-Accel-Buffering turns off nginx-style buffering.
  "Cache-Control": "private, no-store, no-transform",
  "X-Accel-Buffering": "no",
};

export function wantsTurnStream(request: Request) {
  return (request.headers.get("accept") ?? "").includes("text/event-stream");
}

type Dependencies = Partial<Pick<CoordinatorTurnDependencies, "infer" | "research" | "fetcher" | "now" | "readExcerpt" | "isOperator" | "deadlines">> & { schedule?: (work: () => Promise<unknown>) => void };

export function coordinatorTurnStream(slug: string, rawCommand: unknown, request: Request, dependencies: Dependencies = {}): Response {
  const parsed = TurnCommandSchema.safeParse(rawCommand);
  // A malformed command never opens a stream: it gets the same 400 as the JSON route.
  if (!parsed.success) return coordinatorErrorResponse(parsed.error);
  const command = parsed.data, commandId = command.commandId;
  const encoder = new TextEncoder();
  let sink: ReadableStreamDefaultController<Uint8Array> | null = null, open = true, seq = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { sink = controller; controller.enqueue(encoder.encode(": accepted-connection\n\n")); },
    // The reader went away. The turn keeps running; only the connection is gone.
    cancel() { open = false; },
  });
  const emit = (event: UnnumberedEvent) => {
    const full = { ...event, commandId, seq: seq++ } as TurnStreamEvent;
    if (!open || !sink) return;
    try { sink.enqueue(encoder.encode(`id: ${full.seq}\nevent: ${full.type}\ndata: ${JSON.stringify(full)}\n\n`)); } catch { open = false; }
  };
  const stop = new AbortController();
  // A second stream for the same command id (a retry racing the first) replaces the stop handle; both still resolve to the one saved turn.
  running.set(commandId, stop);
  const work = runCoordinatorTurn(slug, command, {
    request, stopSignal: stop.signal,
    ...(dependencies.infer ? { infer: dependencies.infer } : {}), ...(dependencies.research ? { research: dependencies.research } : {}),
    ...(dependencies.fetcher ? { fetcher: dependencies.fetcher } : {}), ...(dependencies.now ? { now: dependencies.now } : {}), ...(dependencies.readExcerpt ? { readExcerpt: dependencies.readExcerpt } : {}), ...(dependencies.isOperator ? { isOperator: dependencies.isOperator } : {}), ...(dependencies.deadlines ? { deadlines: dependencies.deadlines } : {}),
    onAccepted: turn => emit({ type: "accepted", ...turn }),
    onPhase: phase => emit({ type: "phase", phase }),
    onReplyDelta: text => emit({ type: "text", text: text.slice(0, 4000) }),
    // Past this point the outcome is being saved; a Stop can no longer change it, so it must not claim to.
    onCommitting: () => { if (running.get(commandId) === stop) running.delete(commandId); },
  }).then(result => emit({ type: "completed", result }), error => {
    const wire = coordinatorErrorFrom(error);
    // Fixed codes only; no trip IDs, input, error messages, or model output.
    console.warn("commons.coordinator.turn_failed", { stage: "turns_stream", status: coordinatorErrorCatalog[wire.code].httpStatus, reason: coordinatorErrorCode(error) });
    emit({ type: "rejected", error: wire, status: coordinatorErrorCatalog[wire.code].httpStatus });
  }).finally(() => {
    if (running.get(commandId) === stop) running.delete(commandId);
    if (open && sink) { try { sink.close(); } catch { /* already closed */ } }
    open = false;
  });
  // Keeps the function alive until the turn is committed, even after the reader leaves. Outside a Next request (tests, scripts) there is no request
  // lifetime to extend; the work is already running and completes on its own.
  (dependencies.schedule ?? (task => { try { after(task); } catch { /* no request scope */ } }))(() => work);
  return new Response(stream, { headers: streamHeaders });
}

// ---------------------------------------------------------------------------
// Durable turns (conversation durability A2): this request only accepts and observes. The turn runner executes in another process.
// ---------------------------------------------------------------------------

/** Voice keeps its live session transport; every typed organizer turn may be admitted durably while the runner is healthy. */
export async function durableAdmissionAvailable(command: TurnCommand) {
  if (!durableCoordinatorTurnsEnabled() || command.inputMode !== "text" || command.voice) return false;
  try { return await coordinatorTurnRunnerHealthy(commonsDatabaseUrl() ?? undefined); } catch { return false; }
}

/** Accepts the turn and its execution row in one transaction. Nothing runs here; the result is the saved pending turn (or a replayed saved result). */
export async function admitDurableCoordinatorTurn(slug: string, command: TurnCommand, request: Request, onAccepted?: CoordinatorTurnDependencies["onAccepted"]) {
  let authUserId: string | null = null;
  try { authUserId = (await getCommonsAuthIdentity())?.authUserId ?? null; } catch { authUserId = null; }
  return runCoordinatorTurn(slug, command, { request, durable: { mode: "admit", authUserId }, ...(onAccepted ? { onAccepted } : {}) });
}

/**
 * The same event stream as `coordinatorTurnStream`, observed from the database: `accepted` once the turn and its execution row are saved, then each
 * phase and guarded reply-so-far the runner records, then the saved result. Closing the connection only stops observing; the runner keeps the work.
 * Observation is bounded (`maxObserveMs`); when it ends first, the client looks the command up as it does after any dropped stream. No model calls.
 */
export function coordinatorDurableTurnStream(slug: string, command: TurnCommand, request: Request, scope: { databaseUrl: string; actorPersonId: string }, options: { pollMs?: number; maxObserveMs?: number } = {}): Response {
  const encoder = new TextEncoder(), commandId = command.commandId, pollMs = Math.max(50, options.pollMs ?? 300), maxObserveMs = options.maxObserveMs ?? 170_000;
  let sink: ReadableStreamDefaultController<Uint8Array> | null = null, open = true, seq = 0;
  const emit = (event: UnnumberedEvent) => {
    const full = { ...event, commandId, seq: seq++ } as TurnStreamEvent;
    if (!open || !sink) return;
    try { sink.enqueue(encoder.encode(`id: ${full.seq}\nevent: ${full.type}\ndata: ${JSON.stringify(full)}\n\n`)); } catch { open = false; }
  };
  const close = () => { if (open && sink) { try { sink.close(); } catch { /* already closed */ } } open = false; };
  const observe = async () => {
    let result;
    try { result = await admitDurableCoordinatorTurn(slug, command, request, turn => emit({ type: "accepted", ...turn })); }
    catch (error) {
      const wire = coordinatorErrorFrom(error);
      console.warn("commons.coordinator.turn_failed", { stage: "turns_durable", status: coordinatorErrorCatalog[wire.code].httpStatus, reason: coordinatorErrorCode(error) });
      emit({ type: "rejected", error: wire, status: coordinatorErrorCatalog[wire.code].httpStatus }); return close();
    }
    if (result.status !== "pending") { emit({ type: "completed", result }); return close(); }
    const started = Date.now();
    let lastSeq = -1, lastPhase: string | null = null, lastText: string | null = null, tick = 0;
    while (open && Date.now() - started < maxObserveMs) {
      await new Promise(resolve => setTimeout(resolve, pollMs));
      tick += 1;
      const execution = await readCoordinatorTurnExecution(slug, commandId, scope).catch(() => null);
      if (execution?.progress && execution.progress.seq !== lastSeq) {
        lastSeq = execution.progress.seq;
        const phase = TurnPhaseSchema.safeParse(execution.progress.phase);
        if (phase.success && phase.data !== lastPhase) { lastPhase = phase.data; emit({ type: "phase", phase: phase.data }); }
        if (execution.progress.text && execution.progress.text !== lastText) { lastText = execution.progress.text; emit({ type: "text", text: lastText.slice(0, 4000) }); }
      }
      // The turn row decides: read it when the execution row says it ended, and every few ticks in case that row is gone.
      if (!execution || (execution.status !== "queued" && execution.status !== "running") || tick % 6 === 0) {
        const record = await findCoordinatorTurnByCommand(slug, commandId, scope).catch(() => null);
        if (record && record.status !== "pending") { emit({ type: "completed", result: turnResultFromRecord(record) }); return close(); }
      }
    }
    close();
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { sink = controller; controller.enqueue(encoder.encode(": accepted-connection\n\n")); void observe(); },
    cancel() { open = false; },
  });
  return new Response(stream, { headers: streamHeaders });
}
