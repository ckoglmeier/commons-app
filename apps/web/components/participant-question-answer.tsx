"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PARTICIPANT_ANSWER_MAX, type ParticipantAnswerReceipt, type RecipientParticipantQuestion } from "@commons/contracts";

/*
 * The traveler's answer form. It states who will see the answer before the button, sends one answer per attempt, and keeps the attempt's
 * submission id with the unsent text so a reload after a dropped response retries the identical request (the server replays the receipt).
 * An answer is reported evidence only: it changes no travel detail, Plan or task.
 */

type Stored = { draft: string; submissionId: string | null; sentBody: string | null };
const storageKey = (questionId: string, revision: number) => `commons:question:${questionId}:rev:${revision}`;
const readStored = (key: string): Stored | null => { try { const value = JSON.parse(window.sessionStorage.getItem(key) ?? "null") as Stored | null; return value && typeof value.draft === "string" ? value : null; } catch { return null; } };
const writeStored = (key: string, value: Stored | null) => { try { if (value) window.sessionStorage.setItem(key, JSON.stringify(value)); else window.sessionStorage.removeItem(key); } catch { /* The form still works without storage. */ } };
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const joinNames = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
class AnswerError extends Error { constructor(message: string, readonly code: string) { super(message); } }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, init); } catch { throw new AnswerError("Your answer wasn’t confirmed. Check your connection and share it again. It won’t be saved twice.", "network"); }
  const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) throw new AnswerError(body?.error?.message || "Answer not saved. It’s still here.", body?.error?.code ?? "error");
  return body as T;
}

const stateLine: Record<string, string> = {
  expired: "This question expired. New answers can’t be saved.", closed: "This question is closed. New answers can’t be saved.", cancelled: "This question was withdrawn. New answers can’t be saved.",
};

export function ParticipantQuestionAnswer({ slug, initial }: { slug: string; initial: RecipientParticipantQuestion }) {
  const endpoint = `/api/v1/commons/${encodeURIComponent(slug)}/questions/${encodeURIComponent(initial.questionId)}`;
  const [question, setQuestion] = useState(initial);
  const [editing, setEditing] = useState(initial.canAnswer && !initial.answer);
  const [body, setBody] = useState(""), [pending, setPending] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const revision = question.answer?.revision ?? 0;
  const key = storageKey(question.questionId, revision);
  const attempt = useRef<Stored>({ draft: "", submissionId: null, sentBody: null });
  const field = useRef<HTMLTextAreaElement | null>(null), correctButton = useRef<HTMLButtonElement | null>(null);

  // Recover an unsent draft (and a possibly in-flight submission id) after a reload.
  useEffect(() => {
    if (!editing) return;
    const timer = window.setTimeout(() => { const stored = readStored(key); if (stored) { attempt.current = stored; setBody(stored.draft); } }, 0);
    return () => window.clearTimeout(timer);
  }, [key, editing]);
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);

  const change = (value: string) => { setBody(value); attempt.current = { ...attempt.current, draft: value }; writeStored(key, attempt.current); };
  const startCorrection = () => { setStatus(""); setError(""); const stored = readStored(storageKey(question.questionId, question.answer?.revision ?? 0)); setBody(stored?.draft ?? question.answer?.body ?? ""); if (stored) attempt.current = stored; setEditing(true); };
  const cancelCorrection = () => { setEditing(false); setError(""); requestAnimationFrame(() => correctButton.current?.focus()); };

  const submit = async () => {
    const text = body.trim();
    if (!text || pending) return;
    // The same text retries with the same submission id; changed text is a new attempt.
    const same = attempt.current.submissionId && attempt.current.sentBody === text;
    const submissionId = same ? attempt.current.submissionId! : crypto.randomUUID();
    attempt.current = { draft: body, submissionId, sentBody: text };
    writeStored(key, attempt.current);
    setPending(true); setError(""); setStatus("");
    try {
      const receipt = await request<ParticipantAnswerReceipt>(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionId, body: text, expectedAnswerRevision: revision }) });
      writeStored(key, null); attempt.current = { draft: "", submissionId: null, sentBody: null };
      setQuestion(current => ({ ...current, answer: { revision: receipt.revision, body: text, answeredAt: receipt.answeredAt }, state: "answered" }));
      setEditing(false);
      setStatus(`Shared with ${joinNames(question.sharedWith) || "this trip’s organizers"} at ${when(receipt.answeredAt)}.`);
    } catch (cause) {
      const failure = cause instanceof AnswerError ? cause : new AnswerError("Answer not saved. It’s still here.", "error");
      setError(failure.message);
      if (failure.code === "closed") { setQuestion(current => ({ ...current, canAnswer: false, state: current.answer ? current.state : "closed" })); setEditing(false); }
      if (failure.code === "stale") {
        try { const fresh = await request<RecipientParticipantQuestion>(endpoint, { cache: "no-store" }); attempt.current = { draft: body, submissionId: null, sentBody: null }; setQuestion(fresh); setEditing(fresh.canAnswer); } catch { /* The message above still applies. */ }
      }
    } finally { setPending(false); }
  };

  const shared = question.sharedWith.length ? `Shared with ${joinNames(question.sharedWith)} (this trip’s organizers).` : "Shared with this trip’s organizers.";
  return <article className="pq-answer-page">
    <span className="view-kicker">{question.tripName}</span>
    <h1>{question.askedBy} asked</h1>
    <p className="pq-purpose">{question.purpose}</p>
    <blockquote className="pq-ask">{question.question}</blockquote>
    <p className="review-caption">Answer by <time dateTime={question.expiresAt} suppressHydrationWarning>{when(question.expiresAt)}</time></p>
    {!question.canAnswer && stateLine[question.state] ? <p className="cm-note" role="status">{stateLine[question.state]}{question.answer ? " Your saved answer is below." : ""}</p> : null}
    {question.answer && !editing ? <section className="pq-answer" aria-label="Your answer">
      <h2>Your answer</h2>
      <p className="pq-text">{question.answer.body}</p>
      <p className="review-caption">Saved <time dateTime={question.answer.answeredAt} suppressHydrationWarning>{when(question.answer.answeredAt)}</time>. {shared} Only this answer is shared. Nothing else from your trip.</p>
      {question.canAnswer ? <div className="workspace-actions"><button ref={correctButton} type="button" className="cm-action" disabled={pending} onClick={startCorrection}>Correct my answer</button></div> : null}
    </section> : null}
    {editing && question.canAnswer ? <form className="pq-form" onSubmit={event => { event.preventDefault(); void submit(); }} onKeyDownCapture={event => { if (event.key === "Escape" && question.answer) { event.stopPropagation(); cancelCorrection(); } }}>
      <label htmlFor="pq-answer-body">Your answer</label>
      <textarea id="pq-answer-body" ref={field} required rows={5} maxLength={PARTICIPANT_ANSWER_MAX} value={body} onChange={event => change(event.target.value)} aria-describedby="pq-visibility" />
      <p id="pq-visibility" className="review-caption">{shared} Only this answer is shared. Nothing else from your trip.</p>
      <div className="workspace-actions">
        <button className="cm-action cm-action--primary" disabled={pending || !body.trim()}>{pending ? "Sharing…" : question.answer ? "Share corrected answer" : "Share my answer"}</button>
        {question.answer ? <button type="button" className="cm-action" disabled={pending} onClick={cancelCorrection}>Keep earlier answer</button> : null}
      </div>
    </form> : null}
    {error ? <p className="cm-note" role="alert">{error}</p> : null}
    {status ? <p className="cm-note cm-note--done" role="status">{status}</p> : null}
    <p className="review-caption">This doesn’t change your travel details or the plan.</p>
    <Link className="cm-action" href={`/c/${slug}`}>Back to the trip</Link>
  </article>;
}
