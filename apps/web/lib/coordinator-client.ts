import { CoordinatorErrorCodeSchema, CoordinatorErrorSchema, TurnResultSchema, TurnStreamEventSchema, coordinatorError, type CoordinatorError, type CoordinatorErrorCode, type TurnCommand, type TurnPhase, type TurnResult, type TurnStreamEvent } from "@commons/contracts";

/*
 * Browser side of the coordinator turn contract (docs/COORDINATOR-WORKSPACE-DESIGN.md §16.7). Framework-free so the Workspace, the
 * Home entry and tests share one implementation of: sending a command, finding out what happened after a timeout or reload
 * (lookup by command id BEFORE any retry), and turning a stable error code into copy plus a recovery.
 */

const jsonHeaders = { "Content-Type": "application/json" };

export function coordinatorEndpoint(slug: string) { return `/api/v1/commons/${slug}/coordinator`; }

// ---------------------------------------------------------------------------
// Errors: one code, one message, one recovery. Never guess from prose.
// ---------------------------------------------------------------------------

/** What the person can do next. `refresh` means the client reloads authoritative state itself; the person resends. */
export type CoordinatorRecovery = "none" | "retry" | "sign_in" | "refresh";

export function recoveryFor(code: CoordinatorErrorCode): CoordinatorRecovery {
  if (code === "auth_expired") return "sign_in";
  if (code === "stale_version") return "refresh";
  if (code === "provider_failed" || code === "internal_error" || code === "rate_limited") return "retry";
  return "none";
}

export function signInHref(returnPath: string) { return `/sign-in?next=${encodeURIComponent(returnPath)}`; }

/**
 * Reads an error response from any coordinator route: the turn routes (`{ error: {code, retryable, userMessage} }`), the
 * legacy routes (`{ error: string, code, retryable }`), or a status alone. Unknown shapes with a server-written string keep that
 * string; they never become "wrong account" copy.
 */
export function errorFromResponse(status: number, body: unknown): CoordinatorError {
  const record = (body && typeof body === "object" ? body : {}) as { error?: unknown; code?: unknown };
  if (record.error && typeof record.error === "object") {
    const parsed = CoordinatorErrorSchema.safeParse(record.error);
    if (parsed.success) return parsed.data;
  }
  const code = CoordinatorErrorCodeSchema.safeParse(record.code);
  if (code.success) return coordinatorError(code.data);
  if (status === 401) return coordinatorError("auth_expired");
  if (status === 429) return coordinatorError("rate_limited");
  const text = typeof record.error === "string" && record.error.trim() ? record.error.trim().slice(0, 300) : null;
  return text ? { code: "internal_error", retryable: false, userMessage: text } : coordinatorError("internal_error");
}

/** An HTTP failure with its stable code, for callers that prefer exceptions. */
export class CoordinatorRequestError extends Error {
  constructor(readonly error: CoordinatorError, readonly status: number) { super(error.userMessage); this.name = "CoordinatorRequestError"; }
  get code() { return this.error.code; }
}

export type CoordinatorFailure = { message: string; code: CoordinatorErrorCode | null };
export function failureFrom(cause: unknown, fallback: string): CoordinatorFailure {
  if (cause instanceof CoordinatorRequestError) return { message: cause.error.userMessage, code: cause.error.code };
  return { message: cause instanceof Error && cause.message ? cause.message : fallback, code: null };
}

/** JSON request that throws a `CoordinatorRequestError` carrying the stable code on any non-2xx response. */
export async function requestJson<T = unknown>(url: string, init: RequestInit & { fetcher?: typeof fetch } = {}): Promise<T> {
  const { fetcher = fetch, ...rest } = init;
  const response = await fetcher(url, rest);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new CoordinatorRequestError(errorFromResponse(response.status, body), response.status);
  return body as T;
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

/**
 * The outcome of sending one command.
 * - `result`: the request was saved. `result.status` is completed, failed (record + Try again) or still pending.
 * - `rejected`: the server refused before saving anything (auth, membership, stale version, rate limit, ...).
 * - `not_saved`: the connection failed and lookup found no record, twice (the second after a short pause). That is strong evidence, not proof: a request
 *   that was still being committed can land after the lookups, so the copy says "not confirmed", never "nothing was saved". Resending the same id is
 *   always safe: it is saved once whether or not the first attempt arrives.
 * - `unconfirmed`: the connection failed and lookup could not be reached either; nothing may be assumed.
 */
export type TurnSettled =
  | { kind: "result"; result: TurnResult }
  | { kind: "rejected"; error: CoordinatorError; status: number }
  | { kind: "not_saved" }
  | { kind: "unconfirmed" };

type Transport = { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void>; pollMs?: number; lookupAttempts?: number; missingRetryMs?: number; isActive?: () => boolean };

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Defaults for looking a command up after an unknown outcome. Mutable only so tests can shorten the waits.
 * `missingRetryMs`: a lookup can race ahead of the commit of the request it asks about, so a "nothing found" answer is asked a second time
 * after this pause before it is believed.
 */
export const recoveryTiming = { pollMs: 1_500, lookupAttempts: 4, missingRetryMs: 800 };

/** One POST to /turns. A network failure, abort, or unreadable body is `unconfirmed`, never a guess. */
export async function postTurn(slug: string, command: TurnCommand, options: Transport & { signal?: AbortSignal } = {}): Promise<TurnSettled> {
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${coordinatorEndpoint(slug)}/turns`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(command), ...(options.signal ? { signal: options.signal } : {}) });
  } catch { return { kind: "unconfirmed" }; }
  const body = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = TurnResultSchema.safeParse(body);
    return parsed.success ? { kind: "result", result: parsed.data } : { kind: "unconfirmed" };
  }
  const error = errorFromResponse(response.status, body);
  // An unexpected server failure can happen after the pending turn was saved; the record is the truth, so look before deciding.
  if (error.code === "internal_error") return { kind: "unconfirmed" };
  return { kind: "rejected", error, status: response.status };
}

export type TurnLookup = { kind: "found"; result: TurnResult } | { kind: "missing" } | { kind: "rejected"; error: CoordinatorError; status: number } | { kind: "unreachable" };

/** GET /turns/[commandId]: what happened to this command? Never repeats work. */
export async function lookupTurn(slug: string, commandId: string, options: Transport = {}): Promise<TurnLookup> {
  let response: Response;
  try { response = await (options.fetcher ?? fetch)(`${coordinatorEndpoint(slug)}/turns/${commandId}`, { cache: "no-store" }); } catch { return { kind: "unreachable" }; }
  const body = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = TurnResultSchema.safeParse(body);
    return parsed.success ? { kind: "found", result: parsed.data } : { kind: "unreachable" };
  }
  const error = errorFromResponse(response.status, body);
  if (error.code === "artifact_missing") return { kind: "missing" };
  return { kind: "rejected", error, status: response.status };
}

/**
 * After a timeout, reload or unreadable response: look up the command until it is no longer pending (bounded). A `missing` lookup is asked once
 * more after a short pause (it may have raced ahead of the request's commit); only two misses in a row are reported, as `not_saved` (not confirmed).
 * A still-pending command is returned as a pending result for the caller to keep watching.
 */
export async function recoverTurn(slug: string, commandId: string, options: Transport = {}): Promise<TurnSettled> {
  const attempts = options.lookupAttempts ?? recoveryTiming.lookupAttempts, sleep = options.sleep ?? defaultSleep, wait = options.pollMs ?? recoveryTiming.pollMs;
  let last: TurnResult | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.isActive?.() === false) return { kind: "unconfirmed" };
    let found = await lookupTurn(slug, commandId, options);
    if (found.kind === "missing") {
      await sleep(options.missingRetryMs ?? recoveryTiming.missingRetryMs);
      if (options.isActive?.() === false) return { kind: "unconfirmed" };
      found = await lookupTurn(slug, commandId, options);
      if (found.kind === "missing") return { kind: "not_saved" };
    }
    if (found.kind === "rejected") return found;
    if (found.kind === "unreachable") { if (attempt === attempts - 1) return last ? { kind: "result", result: last } : { kind: "unconfirmed" }; }
    else { last = found.result; if (found.result.status !== "pending") return { kind: "result", result: found.result }; }
    await sleep(wait);
  }
  return last ? { kind: "result", result: last } : { kind: "unconfirmed" };
}

/** Send one command; when the outcome is unknown, look it up (same command id) before anyone retries. */
export async function sendTurn(slug: string, command: TurnCommand, options: Transport & { signal?: AbortSignal } = {}): Promise<TurnSettled> {
  const first = await postTurn(slug, command, options);
  if (first.kind !== "unconfirmed") return first;
  // "Stop waiting" is not a wish to wait again: check once, and let the caller keep watching a pending turn.
  return recoverTurn(slug, command.commandId, options.signal?.aborted ? { ...options, lookupAttempts: 1 } : options);
}

// ---------------------------------------------------------------------------
// Streamed turns
// ---------------------------------------------------------------------------

/** What the screen shows while a streamed turn runs. Every field comes from a server event; nothing is simulated. */
export type LiveTurnUpdate =
  | { kind: "accepted"; turnId: string; threadId: string; replayed: boolean }
  | { kind: "phase"; phase: TurnPhase }
  | { kind: "text"; text: string };

/**
 * Parses an SSE body into validated turn events, in order, dropping repeats and anything older than the newest event seen (by `seq`). Events for a
 * different command are ignored. Unreadable events are skipped rather than guessed at.
 */
export async function* turnEvents(body: ReadableStream<Uint8Array>, commandId: string): AsyncGenerator<TurnStreamEvent> {
  const reader = body.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  let buffer = "", last = -1;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value.replace(/\r\n?/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        let parsed: ReturnType<typeof TurnStreamEventSchema.safeParse>;
        try { parsed = TurnStreamEventSchema.safeParse(JSON.parse(data)); } catch { continue; }
        if (!parsed.success || parsed.data.commandId !== commandId || parsed.data.seq <= last) continue;
        last = parsed.data.seq;
        yield parsed.data;
      }
    }
  } finally { reader.cancel().catch(() => {}); }
}

/**
 * One streamed POST to /turns. Live updates go to `onUpdate`; the return value has the same meaning as `postTurn`: the saved result, a refusal that
 * saved nothing, or `unconfirmed` when the stream ended (or was stopped) before a final event, so the caller looks the command up before any retry.
 * A server that answers with JSON instead of a stream is read exactly like `postTurn`.
 */
export async function postTurnStream(slug: string, command: TurnCommand, options: Transport & { signal?: AbortSignal; onUpdate?: (update: LiveTurnUpdate) => void } = {}): Promise<TurnSettled> {
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${coordinatorEndpoint(slug)}/turns`, { method: "POST", headers: { ...jsonHeaders, Accept: "text/event-stream" }, body: JSON.stringify(command), ...(options.signal ? { signal: options.signal } : {}) });
  } catch { return { kind: "unconfirmed" }; }
  if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
    const body = await response.json().catch(() => null);
    if (response.ok) { const parsed = TurnResultSchema.safeParse(body); return parsed.success ? { kind: "result", result: parsed.data } : { kind: "unconfirmed" }; }
    const error = errorFromResponse(response.status, body);
    return error.code === "internal_error" ? { kind: "unconfirmed" } : { kind: "rejected", error, status: response.status };
  }
  try {
    for await (const event of turnEvents(response.body, command.commandId)) {
      if (event.type === "completed") return { kind: "result", result: event.result };
      if (event.type === "rejected") return event.error.code === "internal_error" ? { kind: "unconfirmed" } : { kind: "rejected", error: event.error, status: event.status };
      options.onUpdate?.(event.type === "accepted" ? { kind: "accepted", turnId: event.turnId, threadId: event.threadId, replayed: event.replayed }
        : event.type === "phase" ? { kind: "phase", phase: event.phase } : { kind: "text", text: event.text });
    }
  } catch { /* the connection dropped or was stopped: the saved command decides */ }
  return { kind: "unconfirmed" };
}

/** Streamed send; when the outcome is unknown (dropped connection, Stop), look it up by the same command id before anyone retries. */
export async function sendTurnStream(slug: string, command: TurnCommand, options: Transport & { signal?: AbortSignal; onUpdate?: (update: LiveTurnUpdate) => void } = {}): Promise<TurnSettled> {
  const first = await postTurnStream(slug, command, options);
  if (first.kind !== "unconfirmed") return first;
  return recoverTurn(slug, command.commandId, options);
}

/** Ask the server to stop a reply that is still being written. `stopped: false` means it was not running here or had already finished. */
export async function stopTurn(slug: string, commandId: string, options: Transport = {}): Promise<boolean> {
  try {
    const response = await (options.fetcher ?? fetch)(`${coordinatorEndpoint(slug)}/turns/${commandId}/stop`, { method: "POST" });
    const body = await response.json().catch(() => null) as { stopped?: unknown } | null;
    return response.ok && body?.stopped === true;
  } catch { return false; }
}

/** Cmd+Enter (Ctrl+Enter on Windows and Linux) sends, as in other chat tools; plain Enter keeps adding lines. Not while an IME is composing. */
export function isSendShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey?: boolean; altKey?: boolean; nativeEvent?: { isComposing?: boolean } }) {
  return event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.nativeEvent?.isComposing;
}

/** Honest progress copy for each server phase. */
export function phaseLabel(phase: TurnPhase | "sending"): string {
  return { sending: "Sending…", context: "Checking saved trip details…", searching: "Searching the web…", writing: "Writing a reply…", preparing: "Preparing something for you to review…", saving: "Saving the reply…" }[phase];
}

/** A version of the thread as of the last result; send it as the next `expectedTurnVersion`. */
export function turnVersionFrom(result: TurnResult): { threadId: string; turnVersion: number } | null {
  return result.thread ? { threadId: result.thread.id, turnVersion: result.thread.turnVersion } : null;
}

/** Copy for the two settled states that are not a TurnResult. */
export function settledMessage(settled: Exclude<TurnSettled, { kind: "result" }>): string {
  if (settled.kind === "rejected") return settled.error.userMessage;
  if (settled.kind === "not_saved") return "Commons hasn’t confirmed receiving your message yet, and nothing has appeared in the thread. It’s still here. Check again, or send it again as it is: it will be saved only once.";
  return "We couldn’t confirm whether Commons received that. Your message is still here. Check your connection, then check again before sending.";
}

// ---------------------------------------------------------------------------
// Commands in flight: survive a reload so the outcome can be looked up (per actor and trip; sessionStorage only)
// ---------------------------------------------------------------------------

export type StoredCommand = { command: TurnCommand; savedAt: string };
type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}
export function pendingCommandsKey(slug: string, actorId: string) { return `commons:${slug}:${actorId}:coordinator-pending`; }

export function loadPendingCommands(slug: string, actorId: string, storage: StorageLike | null = browserStorage()): StoredCommand[] {
  try {
    const raw = storage?.getItem(pendingCommandsKey(slug, actorId));
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is StoredCommand => Boolean(item) && typeof item === "object" && typeof (item as StoredCommand).command?.commandId === "string").slice(-10) : [];
  } catch { return []; }
}
function writePending(slug: string, actorId: string, commands: StoredCommand[], storage: StorageLike | null) {
  try { storage?.setItem(pendingCommandsKey(slug, actorId), JSON.stringify(commands.slice(-10))); } catch { /* storage is optional */ }
}
/** Saved BEFORE the request is sent, so a reload or timeout can look the command up instead of guessing. */
export function rememberPendingCommand(slug: string, actorId: string, command: TurnCommand, storage: StorageLike | null = browserStorage(), now = new Date()) {
  const others = loadPendingCommands(slug, actorId, storage).filter(item => item.command.commandId !== command.commandId);
  writePending(slug, actorId, [...others, { command, savedAt: now.toISOString() }], storage);
}
export function forgetPendingCommand(slug: string, actorId: string, commandId: string, storage: StorageLike | null = browserStorage()) {
  writePending(slug, actorId, loadPendingCommands(slug, actorId, storage).filter(item => item.command.commandId !== commandId), storage);
}

/**
 * Replies this organizer stopped, remembered for the browser session so a reload still says "You stopped this reply" instead of describing a stop as a
 * failure. The server stores a stop as an unfinished reply (it has no separate code, so older versions can still read the row).
 */
export function stoppedCommandsKey(slug: string, actorId: string) { return `commons:${slug}:${actorId}:coordinator-stopped`; }
export function loadStoppedCommands(slug: string, actorId: string, storage: StorageLike | null = browserStorage()): string[] {
  try {
    const parsed = JSON.parse(storage?.getItem(stoppedCommandsKey(slug, actorId)) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(-20) : [];
  } catch { return []; }
}
export function rememberStoppedCommand(slug: string, actorId: string, commandId: string, storage: StorageLike | null = browserStorage()) {
  try { storage?.setItem(stoppedCommandsKey(slug, actorId), JSON.stringify([...loadStoppedCommands(slug, actorId, storage).filter(id => id !== commandId), commandId].slice(-20))); } catch { /* storage is optional */ }
}

// ---------------------------------------------------------------------------
// Building a command
// ---------------------------------------------------------------------------

export type CommandDestination =
  | { kind: "new"; threadId: string }
  | { kind: "existing"; threadId: string; expectedTurnVersion: number };

/** The stable identity of a request: a resend of the same text to the same place with the same options keeps its command id. */
export function commandKey(input: { destination: CommandDestination; inputMode: "text" | "voice"; text: string; artifact?: TurnCommand["artifact"]; explicitAction?: TurnCommand["explicitAction"]; attachments?: TurnCommand["attachments"] }) {
  return JSON.stringify([input.destination.kind, input.destination.threadId, input.inputMode, input.text, input.artifact ?? null, input.explicitAction ?? null, input.attachments ?? null]);
}

export function buildTurnCommand(input: { commandId: string; destination: CommandDestination; inputMode: "text" | "voice"; text: string; artifact?: TurnCommand["artifact"]; explicitAction?: TurnCommand["explicitAction"]; attachments?: TurnCommand["attachments"]; voice?: { sessionId: string; delegationId: string } }): TurnCommand {
  // A spoken turn is always tied to its real session and delegation; there is no placeholder.
  if (input.inputMode === "voice" && !input.voice) throw new Error("A voice turn needs its session and delegation ids.");
  return {
    commandId: input.commandId,
    target: input.destination.kind === "new" ? { kind: "new", threadId: input.destination.threadId } : { kind: "existing", threadId: input.destination.threadId, expectedTurnVersion: input.destination.expectedTurnVersion },
    inputMode: input.inputMode, text: input.text,
    ...(input.artifact ? { artifact: input.artifact } : {}),
    ...(input.explicitAction ? { explicitAction: input.explicitAction } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    ...(input.inputMode === "voice" ? { voice: input.voice } : {}),
  };
}
