"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PARTICIPANT_PURPOSE_MAX, PARTICIPANT_QUESTION_MAX, type CoordinatorGoal, type OrganizerParticipantQuestion } from "@commons/contracts";

/*
 * Organizer side of "one question to one traveler". Preparing creates a private draft; making it available lets that traveler answer inside
 * Commons. Nothing is texted or emailed, and an answer is reported evidence only: it never changes travel details, the Plan, or the task.
 */

type Recipient = { personId: string; name: string; organizer: boolean };
type Listing = { enabled: boolean; questions: OrganizerParticipantQuestion[]; recipients: Recipient[] };
const closedGoal = (goal: CoordinatorGoal) => ["completed", "cancelled", "failed"].includes(goal.lifecycle);
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const expiryChoices = [{ hours: 24, label: "24 hours" }, { hours: 48, label: "2 days" }, { hours: 72, label: "3 days" }, { hours: 168, label: "7 days" }];

function stateWords(question: OrganizerParticipantQuestion) {
  switch (question.state) {
    case "draft": return "Draft · not shared yet";
    case "waiting": return `Waiting for ${question.recipient.name}`;
    case "answered": return "Answered";
    case "expired": return question.answer ? "Expired" : "Expired · no answer";
    case "closed": return "Closed";
    default: return "Withdrawn";
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body?.error?.message || "Question not saved. Try again.");
  return body as T;
}

export function GoalParticipantQuestions({ slug, goal }: { slug: string; goal: CoordinatorGoal }) {
  const endpoint = `/api/v1/commons/${encodeURIComponent(slug)}/goals/${encodeURIComponent(goal.goalId)}/questions`;
  const [listing, setListing] = useState<Listing | null>(null), [pending, setPending] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const [open, setOpen] = useState(false), [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [recipientPersonId, setRecipient] = useState(""), [purpose, setPurpose] = useState(""), [question, setQuestion] = useState(""), [hours, setHours] = useState(48);
  const opener = useRef<HTMLButtonElement | null>(null), firstField = useRef<HTMLSelectElement | null>(null), keepButton = useRef<HTMLButtonElement | null>(null), withdrawOpener = useRef<HTMLButtonElement | null>(null);
  const commandIds = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    try { setListing(await call<Listing>(endpoint, { cache: "no-store" })); } catch { /* A failed read keeps what is already shown. */ }
  }, [endpoint]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { if (open) firstField.current?.focus(); }, [open]);
  useEffect(() => { if (withdrawing) keepButton.current?.focus(); }, [withdrawing]);

  // One command id per distinct request, so a retry of the same click is the same command.
  const idFor = (fingerprint: string) => { const known = commandIds.current.get(fingerprint); if (known) return known; const id = crypto.randomUUID(); commandIds.current.set(fingerprint, id); return id; };
  const send = async (body: Record<string, unknown>, success: string) => {
    setPending(true); setError(""); setStatus("");
    try { await call(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); setStatus(success); await load(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Question not saved. Try again."); return false; }
    finally { setPending(false); }
  };

  if (!listing || (!listing.enabled && !listing.questions.length)) return null;
  const closeForm = () => { setOpen(false); requestAnimationFrame(() => opener.current?.focus()); };
  const closeWithdraw = () => { setWithdrawing(null); requestAnimationFrame(() => withdrawOpener.current?.focus()); };
  const canAsk = listing.enabled && goal.ownedByMe && !closedGoal(goal);
  const recipient = listing.recipients.find(item => item.personId === recipientPersonId);

  const prepare = async () => {
    const fingerprint = JSON.stringify(["prepare", goal.goalId, goal.revision, recipientPersonId, purpose, question, hours]);
    const ok = await send({ action: "prepare", commandId: idFor(fingerprint), goalId: goal.goalId, expectedGoalRevision: goal.revision, recipientPersonId, purpose: purpose.trim(), question: question.trim(), expiresInHours: hours },
      "Draft prepared. Review it below. Nothing is sent until you make it available.");
    // The id is kept only to make a retry of this attempt idempotent; a later identical question is a new draft.
    if (ok) { commandIds.current.delete(fingerprint); setQuestion(""); setRecipient(""); setPurpose(""); closeForm(); }
  };
  const publish = (item: OrganizerParticipantQuestion) => send({ action: "publish", commandId: idFor(`publish:${item.questionId}:${item.version}`), questionId: item.questionId, expectedVersion: item.version },
    `Made available to ${item.recipient.name} in Commons. No message was sent.`);

  return <section className="pq-section" aria-label="Questions to travelers">
    <h3>Questions to travelers</h3>
    {listing.questions.map(item => <article key={item.questionId} className="pq-question">
      <p className="pq-state"><strong>{stateWords(item)}</strong></p>
      <p className="pq-text">{item.question}</p>
      <p className="review-caption">For {item.recipient.name} · Asked by {item.askedBy.name} · Answer by <time dateTime={item.expiresAt} suppressHydrationWarning>{when(item.expiresAt)}</time></p>
      {item.answer ? <div className="pq-answer">
        <p>{item.recipient.name} answered:</p>
        <blockquote>{item.answer.body}</blockquote>
        <p className="review-caption">Answered <time dateTime={item.answer.answeredAt} suppressHydrationWarning>{when(item.answer.answeredAt)}</time>{item.answer.corrected ? " · Corrected" : ""}</p>
        <p className="review-caption">Reported by {item.recipient.name}. Not saved as a travel detail or Plan change.</p>
      </div> : null}
      {item.state === "draft" && item.canManage ? <div className="workspace-task-form pq-review" role="group" aria-label={`Review question for ${item.recipient.name}`}>
        <p><strong>Review before making it available</strong></p>
        <p>Ask {item.recipient.name}: {item.question}</p>
        <p className="review-caption">{item.recipient.name} will also see why you’re asking: “{item.purpose}”.</p>
        <p className="review-caption">Answer needed by {when(item.expiresAt)}.</p>
        <p className="review-caption">Nothing is sent. Making it available lets {item.recipient.name} answer in Commons. Commons doesn’t text or email them. Only their answer is shared, with this trip’s organizers.</p>
        <div className="workspace-actions">
          <button type="button" className="cm-action cm-action--primary" disabled={pending} onClick={() => void publish(item)}>Make available to {firstName(item.recipient.name)}</button>
          <button type="button" className="cm-action" disabled={pending} onClick={() => void send({ action: "cancel", questionId: item.questionId }, "Draft discarded. Nothing was shared.")}>Discard draft</button>
        </div>
      </div> : null}
      {(item.state === "waiting" || item.state === "answered") && item.canManage ? (withdrawing === item.questionId
        ? <div className="workspace-task-form pq-review" role="group" aria-label="Withdraw question" onKeyDownCapture={event => { if (event.key === "Escape") { event.stopPropagation(); closeWithdraw(); } }}>
          <p>Withdraw this question? {item.recipient.name} won’t be able to answer it. An answer already shared stays in this task.</p>
          <div className="workspace-actions">
            <button type="button" className="cm-action cm-action--destructive" disabled={pending} onClick={() => void send({ action: "cancel", questionId: item.questionId }, "Question withdrawn.").then(() => setWithdrawing(null))}>Withdraw question</button>
            <button ref={keepButton} type="button" className="cm-action" disabled={pending} onClick={closeWithdraw}>Keep question</button>
          </div>
        </div>
        : <div className="workspace-actions"><button type="button" className="cm-action cm-action--link" disabled={pending} onClick={event => { withdrawOpener.current = event.currentTarget; setWithdrawing(item.questionId); }}>Withdraw question</button></div>) : null}
    </article>)}
    {canAsk ? <>
      <div className="workspace-actions"><button ref={opener} type="button" className="cm-action" aria-expanded={open} disabled={pending} onClick={() => open ? closeForm() : setOpen(true)}>Ask a traveler</button></div>
      {open ? <form className="workspace-task-form pq-form" role="group" aria-label="Ask a traveler" onKeyDownCapture={event => { if (event.key === "Escape") { event.stopPropagation(); closeForm(); } }} onSubmit={event => { event.preventDefault(); void prepare(); }}>
        <label>Who should answer?<select ref={firstField} required value={recipientPersonId} onChange={event => setRecipient(event.target.value)}><option value="">Choose a traveler</option>{listing.recipients.map(person => <option key={person.personId} value={person.personId}>{person.name}</option>)}</select></label>
        <label>Why you’re asking (they’ll see this)<input required placeholder="For example: to plan the airport pickup" maxLength={PARTICIPANT_PURPOSE_MAX} value={purpose} onChange={event => setPurpose(event.target.value)} /></label>
        <label>Question<textarea required maxLength={PARTICIPANT_QUESTION_MAX} rows={3} value={question} onChange={event => setQuestion(event.target.value)} /></label>
        <p className="review-caption">{question.length}/{PARTICIPANT_QUESTION_MAX}. Keep it to one short question.</p>
        <label>Answer needed within<select value={hours} onChange={event => setHours(Number(event.target.value))}>{expiryChoices.map(choice => <option key={choice.hours} value={choice.hours}>{choice.label}</option>)}</select></label>
        <p className="review-caption">{recipient ? `${recipient.name}’s` : "The traveler’s"} answer will be seen by this trip’s organizers. You review the draft first. Commons doesn’t text or email them.</p>
        <div className="workspace-actions"><button className="cm-action cm-action--primary" disabled={pending || !recipientPersonId || !question.trim() || !purpose.trim()}>Prepare question</button><button type="button" className="cm-action" disabled={pending} onClick={closeForm}>Cancel</button></div>
      </form> : null}
    </> : null}
    {error ? <p className="cm-note" role="alert">{error}</p> : null}
    {status ? <p className="cm-note cm-note--done" role="status">{status}</p> : null}
  </section>;
}
