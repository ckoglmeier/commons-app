"use client";
import { useRef, useState } from "react";
import type { PollQuestion, PollWorkingDraft } from "@commons/contracts";
import { PollFramingResponseSchema, type PollSuggestion, type PollSuggestionScope } from "@/lib/poll-suggestions";
import { planFramingApply } from "@/lib/poll-framing-apply";
import { trackProductEvent } from "@/lib/product-analytics";

export type FramingApplyResult = "applied" | "conflict" | "failed";
type Candidate = { suggestion: PollSuggestion; scope: PollSuggestionScope; revision: string; mode: "write" | "revise" };

/**
 * Help me write this. Sends a saved draft's id and version, never the text itself. The result is only a suggestion until the
 * organizer applies it; it publishes nothing and changes no Plan.
 */
export function PollQuestionAssistance({ slug, revision, title, defaultTitle, intro, questions, framingRequest, onFramingRequest, ready, saveDraft, onApply, available = false }: {
  available?: boolean; slug: string; revision: string; title: string; defaultTitle: string; intro: string; questions: PollQuestion[];
  framingRequest: string; onFramingRequest: (value: string) => void; ready: boolean;
  saveDraft: () => Promise<PollWorkingDraft | undefined>;
  onApply: (next: { title: string; intro: string; questions: PollQuestion[] }) => Promise<FramingApplyResult>;
}) {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [change, setChange] = useState("");
  const locked = useRef(false);
  const counts = (suggestion: PollSuggestion) => ({ questionCount: suggestion.questions.length, optionCount: suggestion.questions.reduce((total, question) => total + question.options.length, 0) });

  async function generate(mode: "write" | "revise") {
    if (locked.current || !available || !ready || (mode === "revise" && change.trim().length < 3)) return;
    locked.current = true; setBusy(true); setError("");
    const requestRevision = revision, ask = mode === "revise" ? change.trim() : undefined;
    trackProductEvent("poll_assist_requested", { commonsSlug: slug, properties: { mode, questionCount: questions.length } });
    try {
      const draft = await saveDraft();
      if (!draft) { setError("The draft didn’t save, so help wasn’t requested. Your draft is unchanged."); return; }
      const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/poll-suggestions`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id, version: draft.version, commandId: crypto.randomUUID(), ...(ask ? { change: ask } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        trackProductEvent("poll_assist_failed", { commonsSlug: slug, properties: { mode, status: response.status, code: typeof body.code === "string" ? body.code : null } });
        setError(typeof body.error === "string" ? body.error : "Writing help didn’t finish. Your draft is unchanged.");
        return;
      }
      const parsed = PollFramingResponseSchema.parse(body);
      setCandidate({ suggestion: parsed.suggestion, scope: parsed.scope, revision: requestRevision, mode });
      if (mode === "revise") setChange("");
    } catch {
      trackProductEvent("poll_assist_failed", { commonsSlug: slug, properties: { mode, status: 0, code: "client" } });
      setError("Writing help didn’t finish. Your draft is unchanged.");
    } finally { locked.current = false; setBusy(false); }
  }

  const stale = Boolean(candidate && candidate.revision !== revision);
  async function apply() {
    if (!candidate || busy || locked.current) return;
    const plan = planFramingApply({ suggestion: candidate.suggestion, scope: candidate.scope, mode: candidate.mode, requestRevision: candidate.revision, currentRevision: revision, title, defaultTitle, intro, questions });
    if (!plan.ok) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const result = await onApply({ title: plan.title, intro: plan.intro, questions: plan.questions });
      if (result === "applied") {
        trackProductEvent("poll_assist_applied", { commonsSlug: slug, properties: { mode: candidate.mode, ...counts(candidate.suggestion) } });
        setCandidate(null);
      } else setError(result === "conflict"
        ? "Newer edits to this draft exist. Your draft and this suggestion are both kept. Reload the draft to see the newer edits."
        : "The suggestion wasn’t applied. Your draft is unchanged and the suggestion is kept.");
    } finally { locked.current = false; setBusy(false); }
  }

  if (!available) return <p className="poll-suggestion-status">Writing help isn’t available here yet. Write the introduction and questions below.</p>;
  return <section className="poll-framing-help" aria-label="Commons writing help">
    <label className="fieldnotes-field"><span>What needs deciding?</span>
      <textarea value={framingRequest} onChange={event => onFramingRequest(event.target.value)} maxLength={500} rows={3} placeholder="Help us pick between these two activities for Saturday" />
      <small>Not shared. The group sees only the introduction and questions you share.</small></label>
    <button className="cm-action cm-action--primary" type="button" disabled={busy || !ready} onClick={() => void generate("write")}>{busy && !candidate ? "Writing a draft…" : "Help me write this"}</button>
    {!ready ? <p>Describe what needs deciding first.</p> : null}
    <p className="poll-framing-privacy">Help sends this description, your Already decided notes, the trip’s name, dates, place, time zone, currency, number of travelers, and the options in this draft to OpenAI. It never sends names, private notes, or confirmation codes. Nothing reaches the group until you publish the poll.</p>
    {busy ? <p role="status">Nothing is replaced until you choose Use this draft.</p> : null}
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    {!candidate && questions.length ? <div className="poll-framing-change">
      <label className="fieldnotes-field"><span>Ask for a change to this draft</span><input value={change} onChange={event => setChange(event.target.value)} maxLength={300} placeholder="Make the introduction shorter, or add a question about timing" disabled={busy} /></label>
      <button className="cm-action" type="button" disabled={busy || !ready || change.trim().length < 3} onClick={() => void generate("revise")}>Suggest this change</button>
      <p></p>
    </div> : null}
    {candidate ? <div className="poll-preview poll-framing-suggestion">
      <h3>Commons suggestion · Review before using</h3><p>{candidate.suggestion.explanation}</p>
      {candidate.suggestion.clarification ? <p>{candidate.suggestion.clarification} Add that to “What needs deciding?”, then ask again.</p> : <>
        {candidate.suggestion.title ? <p><strong>Title</strong> · {candidate.suggestion.title}</p> : null}
        {candidate.suggestion.introduction ? <><h4>Introduction for the group</h4><p>{candidate.suggestion.introduction}</p></> : null}
        <ol>{candidate.suggestion.questions.map((question, index) => <li key={index}><strong>{question.prompt}</strong><p>{question.kind === "text" ? "Written answer" : question.selectionMode === "multiple" ? "Choose all that work" : "Choose one"} · {question.required ? "Required" : "Optional"}</p>{question.kind === "choice" ? <ul>{question.options.map((option, optionIndex) => <li key={optionIndex}>{option.label}{option.description ? ` — ${option.description}` : ""}</li>)}</ul> : null}</li>)}</ol>
        {stale ? <p role="status">Your draft changed after this request. Ask again.</p> : <p>Using this draft replaces the introduction and these questions. Your other settings stay.</p>}
        <div className="fieldnotes-toolbar">
          <button className="cm-action cm-action--primary" type="button" disabled={busy || stale} onClick={() => void apply()}>Use this draft</button>
          <button className="cm-action" type="button" disabled={busy} onClick={() => setCandidate(null)}>Discard suggestion</button>
        </div>
      </>}
      {candidate.suggestion.clarification ? <button className="cm-action" type="button" onClick={() => setCandidate(null)}>Discard suggestion</button> : null}
    </div> : null}
  </section>;
}
