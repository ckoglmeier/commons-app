import { coordinatorErrorCatalog, type CoordinatorErrorCode, type TurnResult } from "@commons/contracts";

/**
 * Pure helpers for the voice conversation (design section 10). Nothing here touches the network, the microphone or React, so every rule
 * (utterance boundaries, the structured result the speaking model receives, captions, the delegation queue) is tested directly.
 */

// ---------------------------------------------------------------------------
// Utterance boundaries
// ---------------------------------------------------------------------------

export type LiveTranscriptFragment = { delta: string; startMs: number; endMs: number };

/** Longest request sent as one turn. Longer speech is cut at a sentence boundary and the organizer is told. */
export const MAX_VOICE_REQUEST_CHARS = 2_000;
/** A fragment that starts within this window after the delegation offset still belongs to the request (transcript deltas trail the event). */
export const TRANSCRIPT_LOOKAHEAD_MS = 250;

export type VoiceRequest = { text: string; truncated: boolean; boundaryMs: number | null };

/**
 * The words of exactly one request: fragments that end after the previous request's boundary and start before this delegation's
 * offset (plus a short lookahead). The boundary advances to the last included fragment's end, so the beginning of a request is never
 * dropped and two independent requests are never merged. Empty means "ask the organizer to repeat"; no turn is created.
 */
export function voiceRequestFrom(fragments: LiveTranscriptFragment[], afterMs: number, delegationOffsetMs: number): VoiceRequest {
  const included = fragments
    .filter(fragment => fragment.endMs > afterMs && fragment.startMs < delegationOffsetMs + TRANSCRIPT_LOOKAHEAD_MS)
    .sort((a, b) => a.startMs - b.startMs);
  const joined = included.map(fragment => fragment.delta).join("").replace(/\s+/g, " ").trim();
  if (!joined) return { text: "", truncated: false, boundaryMs: null };
  const boundaryMs = Math.max(...included.map(fragment => fragment.endMs));
  if (joined.length <= MAX_VOICE_REQUEST_CHARS) return { text: joined, truncated: false, boundaryMs };
  const head = joined.slice(0, MAX_VOICE_REQUEST_CHARS);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  const word = head.lastIndexOf(" ");
  const cut = sentence > MAX_VOICE_REQUEST_CHARS / 2 ? head.slice(0, sentence + 1) : word > 0 ? head.slice(0, word) : head;
  return { text: cut.trim(), truncated: true, boundaryMs };
}

// ---------------------------------------------------------------------------
// What the speaking model is told (structured results, never raw errors)
// ---------------------------------------------------------------------------

/** What the Workspace hands back for one delegation. Anything that is not a saved `TurnResult` is described, never improvised. */
export type VoiceDelegateOutcome =
  /** `navigationApplied`: what the Workspace actually did with a switched/created navigation result: true = it opened the thread; false = it did not (the organizer had moved to another thread, or the thread could not be loaded). Absent when the result has no navigation. */
  | { kind: "result"; result: TurnResult; navigationApplied?: boolean }
  /** Refused before anything was saved (sign-in, membership, stale version, rate limit ...). `answerOnly`: no artifact was attached. */
  | { kind: "rejected"; code: CoordinatorErrorCode; answerOnly: boolean }
  /** The connection failed and a lookup proved Commons never received it. */
  | { kind: "not_saved" }
  /** The connection failed and nothing is known: the request may or may not be saved. */
  | { kind: "unconfirmed" }
  /** A reply from before threads (a selected draft, poll or note): only its text exists. */
  | { kind: "legacy_reply"; text: string }
  /** The Workspace could not start the request at all. */
  | { kind: "notice"; notice: VoiceNotice };

export type VoiceNotice = "busy" | "unheard" | "draft_blocked" | "workspace_conflict" | "unavailable";

/** One delegation as the Workspace receives it. `commandId` is stable per delegation, so a re-delivered event replays instead of repeating. */
export type VoiceDelegation = { text: string; truncated: boolean; delegationId: string; sessionId: string; commandId: string };

/** Live commentary is limited to 500 tokens per append; stay well inside it. */
export const MAX_COMMENTARY_CHARS = 1_400;

/** Milliseconds on a monotonic clock, rounded. A module-level wrapper so components can time work without calling the clock during render. */
export function elapsedMs() { return Math.round(performance.now()); }

/** Free text (a thread title, a reply) inside a bracketed tag or sentence: no markup, quotes or control characters that could mimic the format. */
function plain(value: string, limit: number) {
  const cleaned = value.replace(/[\p{Cc}[\]"`<>{}]/gu, " ").replace(/\s+/g, " ").trim();
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, limit - 1).trimEnd()}…`;
}

function tag(fields: Record<string, string>) {
  return `[commons_result ${Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(" ")}]`;
}

function finish(header: string, body: string) {
  const content = `${header} ${body}`.trim();
  if (content.length <= MAX_COMMENTARY_CHARS) return content;
  return `${content.slice(0, MAX_COMMENTARY_CHARS - 1).trimEnd()}…`;
}

const NOT_APPLIED = "Nothing has been applied or shared.";

/**
 * The structured result the speaking model paraphrases. It reads status, code, capability, navigation, reviewRequired and clarify
 * candidates from the saved `TurnResult`; failures use the catalog's spoken message, never a raw backend string. Code-authored
 * sentences (approval is on screen, what switched) are appended so the model repeats facts the result actually states.
 */
export function spokenDelegationResult(result: TurnResult, options: { truncated?: boolean; navigationApplied?: boolean } = {}): string {
  const navigation = result.navigation;
  // The result says a thread was chosen; whether the Workspace actually opened it is what the organizer sees, and what the coordinator may say.
  const declined = (navigation?.kind === "switched" || navigation?.kind === "created") && options.navigationApplied === false;
  const header = tag({
    status: result.status, code: result.error?.code ?? "none", capability: result.capability ?? "none",
    review: result.reviewRequired ? "yes" : "no",
    navigation: navigation ? declined ? "not_opened" : navigation.kind : "none",
    thread: result.thread ? `"${plain(result.thread.title, 60)}"` : "none",
  });
  if (result.status === "failed") return finish(header, result.error ? coordinatorErrorCatalog[result.error.code].spokenMessage : coordinatorErrorCatalog.internal_error.spokenMessage);
  if (result.status === "pending") return finish(header, "Commons is still working on that. The request is saved in the thread. " + NOT_APPLIED);
  const parts = [plain(result.spokenReply ?? result.durableAnswer ?? "The request is saved in the thread.", 700)];
  if (result.reviewRequired) parts.push(`Approval is on screen: the organizer reviews and approves it in the Workspace. ${NOT_APPLIED}`);
  if (declined && navigation) parts.push(navigation.kind === "created"
    ? `Commons started a separate thread "${plain(navigation.title, 60)}", but the Workspace did not open it because the organizer moved to another thread on screen. It is on the Trip board.`
    : `The Workspace did not open the thread "${plain(navigation.title, 60)}" because the organizer moved to another thread on screen. Nothing switched.`);
  else if (navigation?.kind === "switched") parts.push(`The Workspace is opening the thread "${plain(navigation.title, 60)}".`);
  else if (navigation?.kind === "created") parts.push(`Commons started a separate thread "${plain(navigation.title, 60)}" and the Workspace is opening it.`);
  else if (navigation?.kind === "clarify") parts.push(`Commons has not switched anything. Ask which one: ${navigation.candidates.map(candidate => `"${plain(candidate.title, 60)}"`).join(", ")}.`);
  if (options.truncated) parts.push("The request was long, so only the first part was sent. The thread shows exactly what was sent.");
  return finish(header, parts.join(" "));
}

const NOTICES: Record<VoiceNotice, string> = {
  busy: "I’m still working on your earlier request. Ask again once I’ve answered.",
  unheard: "I didn’t catch enough of that request. Please say it again.",
  draft_blocked: "There are unsaved draft edits on screen. Save or discard them, then ask again. Nothing was changed.",
  workspace_conflict: "The workspace on screen needs to be refreshed before Commons can save anything. Nothing was changed.",
  unavailable: "The coordinator conversation isn’t available right now. Nothing was changed.",
};

/** Everything that is not a saved `TurnResult`, as a structured result. Codes outside the catalog say which local condition applied. */
export function spokenDelegationOutcome(outcome: VoiceDelegateOutcome, options: { truncated?: boolean } = {}): string {
  const bare = (code: string, status: string) => ({ status, code, capability: "none", review: "no", navigation: "none", thread: "none" });
  switch (outcome.kind) {
    case "result": return spokenDelegationResult(outcome.result, { ...options, ...(outcome.navigationApplied !== undefined ? { navigationApplied: outcome.navigationApplied } : {}) });
    case "rejected": return finish(tag(bare(outcome.code, "failed")), `${coordinatorErrorCatalog[outcome.code].spokenMessage} ${NOT_APPLIED}`);
    case "not_saved": return finish(tag(bare("not_saved", "unknown")), "Commons hasn’t confirmed receiving that request yet, so it may still show up in the thread. Check the thread on screen before asking again.");
    case "unconfirmed": return finish(tag(bare("unconfirmed", "unknown")), "I couldn’t confirm whether Commons received that request. It may be saved in the thread, so check the thread on screen before asking again.");
    case "legacy_reply": return finish(tag(bare("none", "completed")), `${plain(outcome.text, 700)}${options.truncated ? " The request was long, so only the first part was sent." : ""}`);
    case "notice": return finish(tag(bare(outcome.notice, "not_run")), NOTICES[outcome.notice]);
  }
}

/** For events and logs: code and capability only (never the reply text). */
export function delegationOutcomeFields(outcome: VoiceDelegateOutcome) {
  switch (outcome.kind) {
    case "result": return { outcome: outcome.result.status === "completed" ? "completed" : outcome.result.status, capability: outcome.result.capability ?? null, errorCode: outcome.result.error?.code ?? null, turnId: outcome.result.turnId };
    case "rejected": return { outcome: "rejected", capability: null, errorCode: outcome.code, turnId: null };
    case "legacy_reply": return { outcome: "completed", capability: null, errorCode: null, turnId: null };
    case "notice": return { outcome: "not_run", capability: null, errorCode: null, turnId: null };
    default: return { outcome: outcome.kind, capability: null, errorCode: null, turnId: null };
  }
}

/** True when the same delegation may be run again (with the same command id): nothing definite is known about it. */
export function isRetryableDelegation(outcome: VoiceDelegateOutcome) {
  return outcome.kind === "unconfirmed" || outcome.kind === "not_saved";
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

export type Caption = { speaker: "you" | "coordinator"; text: string; endMs: number };
export const CAPTION_LIMIT = 280;
/** A pause this long in the transcript timeline starts a new utterance: the caption is replaced, never appended to. */
export const CAPTION_GAP_MS = 1_200;

export function boundCaption(text: string) {
  const compact = text.replace(/\s+/g, " ").trimStart();
  if (compact.length <= CAPTION_LIMIT) return compact;
  const tail = compact.slice(-(CAPTION_LIMIT - 1));
  const space = tail.indexOf(" ");
  return `…${space > 0 && space < 40 ? tail.slice(space + 1) : tail}`;
}

/** One caption line for whoever spoke last: the latest utterance only, bounded, replaced on speaker change or after a pause. */
export function nextCaption(previous: Caption | null, speaker: Caption["speaker"], delta: string, startMs: number | undefined, endMs: number | undefined): Caption {
  const start = startMs ?? previous?.endMs ?? 0, end = endMs ?? start;
  const continues = previous && previous.speaker === speaker && start - previous.endMs <= CAPTION_GAP_MS;
  return { speaker, text: boundCaption(`${continues ? previous.text : ""}${delta}`), endMs: Math.max(end, continues ? previous.endMs : 0) };
}

const FILLER = new Set(["mm", "hmm", "mhm", "uh", "huh", "um", "okay", "ok", "sure", "right", "yeah", "yes", "got", "it", "i", "see", "alright", "thanks", "thank", "you", "cool", "great", "mmhmm"]);

/** Backchannels ("mm-hmm", "okay") are shown but never announced to a screen reader. */
export function isFillerCaption(text: string) {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  return words.length === 0 || (words.length <= 3 && words.every(word => FILLER.has(word)));
}

// ---------------------------------------------------------------------------
// Delegation queue: one at a time, first in first out, at most two waiting
// ---------------------------------------------------------------------------

export class DelegationQueue<Job> {
  private active: Job | null = null;
  private waiting: Job[] = [];
  private closed = false;
  constructor(private readonly run: (job: Job) => Promise<void>, private readonly onChange: () => void = () => {}, readonly maxWaiting = 2) {}

  get running() { return this.active; }
  get waitingCount() { return this.waiting.length; }
  get idle() { return this.active === null && this.waiting.length === 0; }

  /** `started`: runs now. `queued`: runs after the current one. `overflow`: not accepted; the caller says so out loud. */
  submit(job: Job): "started" | "queued" | "overflow" {
    if (this.closed) return "overflow";
    if (this.active === null) { void this.start(job); return "started"; }
    if (this.waiting.length >= this.maxWaiting) return "overflow";
    this.waiting.push(job);
    this.onChange();
    return "queued";
  }

  /** Work that has not started is dropped (nothing was saved for it); the running job is left to finish. */
  close(): Job[] {
    this.closed = true;
    const dropped = this.waiting;
    this.waiting = [];
    this.onChange();
    return dropped;
  }

  private async start(job: Job) {
    this.active = job;
    this.onChange();
    try { await this.run(job); } catch { /* the runner reports its own outcome */ }
    this.active = null;
    const next = this.waiting.shift();
    this.onChange();
    if (next !== undefined && !this.closed) void this.start(next);
  }
}
