import type { CoordinatorResearch, CoordinatorThread, TurnNavigation, TurnPhase, TurnSourceRef } from "@commons/contracts";
import { CoordinatorMark } from "@commons/ui";
import { phaseLabel } from "@/lib/coordinator-client";
import { coordinatorErrorCatalog, type CoordinatorErrorCode } from "@commons/contracts";

/*
 * Stateless pieces of a coordinator turn (docs/COORDINATOR-WORKSPACE-DESIGN.md §16.7). The Workspace stays the only stateful owner;
 * pieces that take callbacks are components, the rest are plain render helpers.
 */

export type WorkspaceTurn = CoordinatorThread["turns"][number];

/** Turns saved before the lifecycle existed have no status; they are completed. */
export function turnStatusOf(turn: WorkspaceTurn) { return turn.status ?? "completed"; }

/** Copy and retry policy for a failed turn come from the stable code, never from prose. */
export function failedTurnCopy(turn: WorkspaceTurn): { code: CoordinatorErrorCode; message: string; retryable: boolean } {
  const code = turn.errorCode ?? "internal_error";
  const entry = coordinatorErrorCatalog[code];
  return { code, message: entry.userMessage, retryable: entry.retryable };
}

/** "From <title>" for other threads, once for saved trip facts, and the poll title; research sources live in the research pane. */
export function sourceLabels(sources: readonly TurnSourceRef[] | null | undefined): Array<{ key: string; label: string }> {
  const labels: Array<{ key: string; label: string }> = [];
  let facts = 0;
  for (const source of sources ?? []) {
    if (source.kind === "thread") labels.push({ key: `thread:${source.threadId}`, label: `From ${source.title}` });
    else if (source.kind === "poll") labels.push({ key: `poll:${source.pollId}`, label: `From poll “${source.title}”` });
    else if (source.kind === "trip_fact") facts += 1;
  }
  if (facts) labels.unshift({ key: "trip-facts", label: `Based on ${facts === 1 ? "a saved trip detail" : "saved trip details"}` });
  return labels;
}

export function turnSources(turn: WorkspaceTurn) {
  const labels = sourceLabels(turn.sources);
  if (!labels.length) return null;
  return <ul className="workspace-turn-sources" aria-label="Where this answer came from">{labels.map(item => <li key={item.key} className="review-caption">{item.label}</li>)}</ul>;
}

/** A completed turn is unsupported when Commons said so; it changes nothing and is never retried. */
export function isUnsupportedTurn(turn: WorkspaceTurn) { return turn.workspace?.capability === "unsupported"; }

export function TurnPending({ own, onCheck, busy }: { own: boolean; onCheck: () => void; busy: boolean }) {
  return <div className="workspace-turn-status" role="status">
    <p>Commons is still working on this. Your message is saved.</p>
    {own ? <button type="button" className="cm-action" disabled={busy} onClick={onCheck}>Check now</button> : null}
    <p className="review-caption">The saved reply will show what happened.</p>
  </div>;
}

/** A reply still arriving in this browser. Status follows real server phases; the text is provisional until the saved reply replaces it. */
export type LiveTurnView = { commandId: string; userText: string; authorName: string; coordinatorName: string; phase: TurnPhase | "sending"; text: string; stopRequested: boolean; stopNote: string | null };

export function LiveTurn({ turn }: { turn: LiveTurnView }) {
  const status = turn.stopRequested && !turn.stopNote ? "Stopping…" : phaseLabel(turn.phase);
  return <article className="review-turn workspace-live-turn" data-turn-status="pending" aria-busy="true">
    <div className="review-chat-user"><strong>{turn.authorName}</strong><p>{turn.userText}</p></div>
    <div>
      <span className="review-coordinator"><CoordinatorMark aria-hidden="true" /> {turn.coordinatorName}</span>
      {turn.text ? <p className="workspace-live-text">{turn.text}</p> : null}
      {/* One polite announcement per phase change; streamed words are never announced one by one. */}
      <p className="review-caption workspace-live-status" role="status">{status}</p>
      {turn.stopNote ? <p className="review-caption" role="status">{turn.stopNote}</p> : null}
    </div>
  </article>;
}

/** The server's record of a Stop on this attempt (any browser or device), or of an attempt whose execution was lost. Older rows have neither. */
export function turnEnding(turn: WorkspaceTurn): "stopped" | "interrupted" | null {
  if (turn.workspace?.stop) return "stopped";
  if (turn.workspace?.interruption) return "interrupted";
  return null;
}

export function TurnFailed({ turn, own, onRetry, busy, stopped = false }: { turn: WorkspaceTurn; own: boolean; onRetry: () => void; busy: boolean; /** The organizer stopped this reply in this browser (older rows have no saved stop record). */ stopped?: boolean }) {
  const { message: catalogMessage, retryable } = failedTurnCopy(turn);
  const ending = turnEnding(turn), wasStopped = stopped || ending === "stopped";
  const message = wasStopped && own ? "You stopped this reply. Your message is saved."
    : wasStopped ? "The organizer who sent this stopped the reply."
    : ending === "interrupted" ? "Commons was interrupted before it finished this reply. Your message is saved, and no answer from it was saved."
    : catalogMessage;
  // A reply the organizer stopped is not an error: neutral styling and a polite status, not an alert.
  const byOrganizer = wasStopped && own;
  return <div className={byOrganizer ? "workspace-turn-status" : "workspace-turn-status workspace-turn-status--failed"} role={byOrganizer ? "status" : "alert"}>
    <p>{message}</p>
    {own && retryable ? <button type="button" className="cm-action" disabled={busy} onClick={onRetry}>Try again</button> : null}
    {own && !retryable ? <p className="review-caption">Your message is saved above.</p> : null}
    {!own ? <p className="review-caption">Only the organizer who sent this can try it again.</p> : null}
  </div>;
}

/** Two to four conversations Commons could not choose between; choosing one opens it. No turn is sent. */
export function ClarifyCandidates({ navigation, onOpen, disabled }: { navigation: TurnNavigation | undefined; onOpen: (threadId: string) => void; disabled: boolean }) {
  if (!navigation || navigation.kind !== "clarify") return null;
  return <div className="workspace-clarify" role="group" aria-label="Which conversation do you mean?">
    <div className="workspace-actions">{navigation.candidates.map(candidate => <button key={candidate.threadId} type="button" className="cm-action workspace-clarify-option" disabled={disabled} onClick={() => onOpen(candidate.threadId)}>{candidate.title}{candidate.detail ? <small>{candidate.detail}</small> : null}</button>)}</div>
    <p className="review-caption">Choose one to open it.</p>
  </div>;
}

/** Source metadata remains saved for audit; readers see sources and only actionable caveats. */
export function researchRunView(run: CoordinatorResearch, key: string, byline: string) {
  return <section className="workspace-work-section workspace-sources" key={key}>
    <h3>{run.query}</h3>
    <p className="review-caption">{byline}</p>
    {run.status === "unavailable" ? <p role="status">Search is unavailable. Try again later.</p> : null}
    {run.sources.some(source => /(?:\$|USD\s*)\s*\d|\d\s*(?:dollars|USD)/i.test(source.excerpt)) ? <p className="review-caption">Check current prices and availability with the provider.</p> : null}
    {run.sources.map(source => <section key={source.id}>
      <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
      <p>{source.excerpt}</p>
      {source.capturedReferenceUrl ? <a href={source.capturedReferenceUrl} target="_blank" rel="noreferrer">View captured reference</a> : null}
    </section>)}
  </section>;
}
