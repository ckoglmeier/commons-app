"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { formatEstimate, recipeStageLabels, type OutcomeView, type RecipeRunDetail } from "@commons/contracts";
import { stableCommand } from "@/lib/recipe-client";

export type Outcome = { ok: boolean; error?: string; code?: string } | undefined;
export type Call = <T>(path: string, method: "GET" | "POST" | "PATCH", body?: unknown) => Promise<{ ok: true; data: T } | { ok: false; error: string; code?: string }>;
export type Act = (work: () => Promise<Outcome>, done?: string) => Promise<void>;
export type PanelProps<D extends RecipeRunDetail = RecipeRunDetail> = { run: D; busy: boolean; act: Act; call: Call; runBase: string };
/** A draft owns its dirty/valid state; its host places publication without duplicating that state. */
export type DraftLayout = (build: ReactNode, share: ReactNode) => ReactNode;

/** What an approved result was built on has since changed. It stays on record; a person decides whether to ask again. */
export function StaleNotice({ outcome }: { outcome: OutcomeView | null }) {
  if (!outcome?.stale.length) return null;
  return <div className="recipe-attention" role="status"><strong>Worth another look.</strong><ul>{outcome.stale.map(item => <li key={item.field}>{item.message}</li>)}</ul><p className="recipe-note">This result is kept as history. Nothing was changed or recalculated for you.</p></div>;
}

export function HeadcountBanner({ run }: { run: RecipeRunDetail }) {
  if (run.context) return null;
  if (!run.headcount) return null;
  return <p className="recipe-context" role="note">Planning for {run.headcount.in} confirmed{run.headcount.maybe ? ` and ${run.headcount.maybe} maybe` : ""}, from the attendance result approved {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(run.headcount.approvedAt))}. Context only; it doesn’t change what anyone answers.</p>;
}

export function ParticipantPollPreview({ run }: { run: RecipeRunDetail }) {
  const preview = run.participantPreview;
  if (!preview) return null;
  return <div className="recipe-preview"><strong>{preview.title}</strong><p>{preview.intro}</p>{preview.questions.map(question => <div key={question.id}>
    <p><strong>{question.prompt}</strong> · {question.required ? "Required" : "Optional"}</p>
    {question.kind === "text" ? <p className="recipe-note">Written answer</p> : <ul>{question.options.map(option => <li key={option.id}>{option.label}
      {option.description ? <p>{option.description}</p> : null}{option.url ? <p><a href={option.url} target="_blank" rel="noreferrer noopener">Property link</a></p> : null}
      {option.property ? <p>{option.property.rooms} · {option.property.beds === "king_only" ? "King beds only" : option.property.beds === "separate_beds_available" ? "Separate beds available" : "Bed setup not listed"} · {formatEstimate(option.property.pricing)}</p> : null}
    </li>)}</ul>}
  </div>)}</div>;
}

/** Who can answer, then an explicit publish. Publishing never emails anyone and never changes the trip. */
export function PublishPanel({ run, busy, act, call, runBase, ready, blockedReason }: PanelProps & { ready: boolean; blockedReason: string }) {
  const [access, setAccess] = useState<"invitees" | "link">("invitees");
  const command = useRef<{ key: string; id: string } | null>(null);
  async function publish() {
    command.current = stableCommand(command.current, { access, version: run.draft.version });
    await act(() => call(`${runBase}/publish`, "POST", { commandId: command.current!.id, expectedDraftVersion: run.draft.version, access }), "Published. Share the link below; nothing was sent.");
  }
  return <section className="recipe-section" aria-labelledby="recipe-access"><h2 id="recipe-access">Who can answer?</h2>
    <details className="fieldnotes-context"><summary>Review the saved poll</summary><ParticipantPollPreview run={run} /></details>
    <fieldset className="recipe-choice"><legend className="recipe-visually-hidden">Who can answer</legend>
      <label><input type="radio" name="access" checked={access === "invitees"} onChange={() => setAccess("invitees")} /><span>Trip invitees · Sign-in required</span><small>Everyone invited to this trip can answer, and you can see who is still to answer.</small></label>
      <label><input type="radio" name="access" checked={access === "link"} onChange={() => setAccess("link")} /><span>Anyone with the link · No sign-in</span><small>Link holders can see the poll and visible results, and answer with a name. They don’t get trip access, and you can’t see who hasn’t answered.</small></label></fieldset>
    {access === "invitees" && run.publicationAudience ? <p className="recipe-note">Included audience: {run.publicationAudience.join(", ") || "No invitees"}.</p> : null}
    <div className="poll-action-row"><button type="button" className="cm-action cm-action--primary" disabled={busy || !ready} onClick={publish}>Share with the group</button></div>
    <p className="recipe-note">{ready ? "Publishing doesn’t email anyone or change the trip." : blockedReason}</p>
  </section>;
}

/** The same saved link stays available after voting closes. No publication or delivery side effects. */
export function PollShareLink({ poll }: { poll: NonNullable<RecipeRunDetail["poll"]> }) {
  const [copied, setCopied] = useState(false), [copyFailed, setCopyFailed] = useState(false);
  const url = typeof window === "undefined" ? `/c/poll/${poll.publicId}` : `${window.location.origin}/c/poll/${poll.publicId}`;
  async function copy() { try { await navigator.clipboard.writeText(url); setCopied(true); setCopyFailed(false); } catch { setCopied(false); setCopyFailed(true); } }
  return <><div className="poll-action-row"><button type="button" className="cm-action cm-action--link" onClick={copy}>Copy poll link</button><span role="status" aria-live="polite" aria-atomic="true">{copied ? "Copied" : ""}</span></div>
    {copyFailed ? <label className="fieldnotes-field"><span>Couldn’t copy automatically. Select and copy this link.</span><input readOnly value={url} onFocus={event => event.currentTarget.select()} /></label> : null}</>;
}

export function SavedPollShare({ slug, run }: { slug: string; run: RecipeRunDetail }) {
  if (!run.poll) return null;
  return <section className="recipe-section" aria-label="Share saved poll"><PollShareLink key={run.poll.publicId} poll={run.poll} />
    <p className="recipe-note">{run.poll.status === "closed" || run.poll.superseded ? "Voting is closed. The link still opens the saved poll." : run.poll.audienceKind === "invitees" ? "Trip invitees sign in to answer. Nothing is sent automatically." : "Anyone with the link can answer. Nothing is sent automatically."}</p>
    <Link className="cm-action" href={`/c/${encodeURIComponent(slug)}/polls/${run.poll.id}`}>See every answer</Link></section>;
}

/** Closing is explicit and independent of approving a result or updating the trip. */
export function CloseVotingControl({ run, busy, act, call, base }: PanelProps & { base: string }) {
  const [confirm, setConfirm] = useState(false), command = useRef<string | null>(null);
  if (!run.poll || run.poll.status !== "open" || run.poll.superseded || run.stage === "closed") return null;
  return <section className="recipe-section" aria-label="Voting controls"><button type="button" className="cm-action" disabled={busy} onClick={() => setConfirm(true)}>Close voting</button>
    {confirm ? <div className="recipe-confirm" role="group" aria-label="Close voting"><p>Close voting? People won’t be able to add or change answers. You can then review and approve a result; the trip won’t change.</p>
      <button type="button" className="cm-action cm-action--primary" disabled={busy} onClick={() => { command.current ??= crypto.randomUUID(); void act(() => call(`${base}/polls/${run.poll!.id}`, "PATCH", { commandId: command.current, status: "closed" }), "Voting is closed."); }}>Close voting</button>
      <button type="button" className="cm-action" disabled={busy} onClick={() => setConfirm(false)}>Keep it open</button></div> : null}</section>;
}

/** The same revision path must remain available after voting closes or context changes. */
export function ReviseRoundControl({ run, busy, act, call, runBase }: PanelProps) {
  const [confirm, setConfirm] = useState(false), command = useRef<string | null>(null);
  const closed = run.stage === "decide" || run.stage === "decided" || run.stage === "applied";
  if (!run.poll || run.poll.superseded || run.stage === "draft" || run.stage === "closed") return null;
  return <div>
    <button type="button" className="cm-action" disabled={busy} onClick={() => setConfirm(true)}>Revise the draft</button>
    {confirm ? <div className="recipe-confirm" role="group" aria-label="Revise the draft"><p><strong>Start another round in this Goal?</strong> {closed ? "The earlier poll and answers stay as history. Any recorded decision and existing trip details won’t be undone." : "This closes the published poll and keeps its answers as history."} You’ll edit a new private draft with no votes. Review its context, then publish and share it again.</p>
      <button type="button" className="cm-action cm-action--primary" disabled={busy} onClick={() => { command.current ??= crypto.randomUUID(); void act(() => call(`${runBase}/revise`, "POST", { commandId: command.current, expectedDraftVersion: run.draft.version }), "Started a new private draft. The old answers are kept as history."); setConfirm(false); }}>{closed ? "Start private revision" : "Close it and revise"}</button>
      <button type="button" className="cm-action" onClick={() => setConfirm(false)}>Not now</button>
    </div> : null}
  </div>;
}

export function History({ slug, run }: { slug: string; run: RecipeRunDetail }) {
  if (!run.history.length) return null;
  return <section className="recipe-section" aria-labelledby="recipe-history"><h2 id="recipe-history">Earlier rounds</h2><ul className="recipe-history">{run.history.map((round, index) => <li key={index}>Round {index + 1} · {recipeStageLabels[round.stage]} · {round.responseCount} {round.responseCount === 1 ? "answer" : "answers"}{round.outcomeStatus === "applied" ? " · its result was applied" : round.outcomeStatus === "superseded" ? " · its result was replaced" : ""}{round.pollId ? <> · <Link href={`/c/${encodeURIComponent(slug)}/polls/${round.pollId}`}>Open results</Link></> : null}</li>)}</ul><p className="recipe-note">Earlier answers stay as they were. A new round starts with no carried-over votes.</p></section>;
}

/** Needs people mentioned in an answer must be explained before approval; a vote doesn't resolve them. */
export function NeedsForm({ run, resolutions, onChange }: { run: RecipeRunDetail; resolutions: Record<string, string>; onChange: (next: Record<string, string>) => void }): ReactNode {
  const needs = run.notes.filter(note => note.kind === "need"), other = run.notes.filter(note => note.kind !== "need");
  return <>
    {needs.length ? <div className="recipe-needs"><h3>Needs people mentioned</h3><p className="recipe-note">Only organizers see these. Say how each is handled before you approve. A vote doesn’t resolve a need.</p>
      {needs.map(note => { const key = `${note.responseId}:${note.questionId}`; return <label className="fieldnotes-field" key={key}><span>{note.respondentName}: {note.text}</span><input type="text" maxLength={500} value={resolutions[key] ?? ""} placeholder="How will this be handled?" onChange={event => onChange({ ...resolutions, [key]: event.target.value })} required /></label>; })}</div> : null}
    {other.length ? <details className="fieldnotes-context"><summary>Other notes from answers ({other.length})</summary><ul className="recipe-history">{other.map(note => <li key={`${note.responseId}-${note.kind}`}><strong>{note.respondentName}</strong> · {note.kind}: {note.text}</li>)}</ul></details> : null}
  </>;
}
export const needsResolved = (run: RecipeRunDetail, resolutions: Record<string, string>) => run.notes.filter(note => note.kind === "need").every(note => resolutions[`${note.responseId}:${note.questionId}`]?.trim());
export const needResolutionPayload = (run: RecipeRunDetail, resolutions: Record<string, string>) => run.notes.filter(note => note.kind === "need").map(note => ({ responseId: note.responseId, questionId: note.questionId, resolution: resolutions[`${note.responseId}:${note.questionId}`].trim() }));
