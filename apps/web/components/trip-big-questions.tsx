"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { TripLetterWelcome } from "./trip-letter-controls";
import { GoingAction } from "./trip-stage-gate";

/*
 * Trip while a group is getting to "we're going" (docs/TRIP-STAGES-DIRECTION.md). The big questions are the page and the
 * guide. Poll answers never decide anything: each question is settled by the organizer, here, in their own words.
 */

type QuestionId = "where" | "when" | "who";
type Question = { id: QuestionId; decided: string | null; poll: { id: string; publicId: string; title: string; open: boolean; answers: number } | null };

type Loaded = { questions: Question[]; welcome: string | null; decideBy: string | null; roughCost: string | null };

const COPY: Record<QuestionId, { title: string; help: string }> = {
  where: { title: "Where are we going?", help: "Add it if you know, or ask your group." },
  when: { title: "When?", help: "Add the dates if you know, or ask what could work." },
  who: { title: "Who’s in?", help: "Add who’s coming, or find out who can make it." },
};

const json = { "content-type": "application/json" };

function Decide({ slug, id, onSaved, onCancel }: { slug: string; id: QuestionId; onSaved: () => void; onCancel: () => void }) {
  const [where, setWhere] = useState(""), [startsOn, setStartsOn] = useState(""), [endsOn, setEndsOn] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { form.current?.querySelector("input")?.focus(); }, []);
  const ready = id === "where" ? where.trim() : id === "when" ? startsOn && endsOn : note.trim();
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError("");
    const body = { commandId: crypto.randomUUID(), question: id, ...(id === "where" ? { locationName: where } : id === "when" ? { startsOn, endsOn } : { note }) };
    const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/big-questions`, { method: "PUT", headers: json, body: JSON.stringify(body) }).catch(() => null);
    if (response?.ok) { onSaved(); return; }
    const payload = await response?.json().catch(() => ({})) as { error?: string } | undefined;
    setError(payload?.error ?? "That didn’t save. Try again."); setBusy(false);
  }
  return <form ref={form} className="big-questions__decide" onSubmit={event => void save(event)}>
    {id === "where" ? <label className="field"><span>Where you’re going</span><input value={where} maxLength={120} onChange={event => setWhere(event.target.value)} /></label> : null}
    {id === "when" ? <div className="big-questions__dates"><label className="field"><span>First day</span><input type="date" value={startsOn} onChange={event => setStartsOn(event.target.value)} /></label><label className="field"><span>Last day</span><input type="date" value={endsOn} min={startsOn || undefined} onChange={event => setEndsOn(event.target.value)} /></label></div> : null}
    {id === "who" ? <label className="field"><span>Who’s in</span><input value={note} maxLength={500} placeholder="Sam, Kit and probably Noor" onChange={event => setNote(event.target.value)} /><small>A note for you. It doesn’t invite anyone.</small></label> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="setup-actions"><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" disabled={!ready || busy}>{busy ? "Saving…" : "Add"}</button></div>
  </form>;
}

export function TripBigQuestions({ slug, tripName }: { slug: string; tripName: string }) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [brief, setBrief] = useState<{ welcome: string | null; decideBy: string | null; roughCost: string | null } | null>(null);
  const [failed, setFailed] = useState(false), [deciding, setDeciding] = useState<QuestionId | null>(null), [copied, setCopied] = useState<QuestionId | null>(null);
  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/big-questions`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) { setFailed(true); return; }
    const view = await response.json() as Loaded;
    setQuestions(view.questions); setBrief(view); setFailed(false);
  }, [slug]);
  useEffect(() => {
    let live = true;
    void fetch(`/api/v1/commons/${encodeURIComponent(slug)}/big-questions`, { cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error("status"); return await response.json() as Loaded; })
      .then(view => { if (live) { setQuestions(view.questions); setBrief(view); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [slug]);

  // One filled button at a time: Add on the next question nobody has started, then "We're going" once they're all moving.
  const nextQuestion = questions?.find(question => !question.decided && !question.poll) ?? null;

  async function copy(question: Question) {
    if (!question.poll) return;
    const link = `${window.location.origin}/c/poll/${question.poll.publicId}`;
    try { await navigator.clipboard.writeText(link); setCopied(question.id); }
    catch { window.prompt("Copy this link", link); }
  }

  return <section className="big-questions cm-document-paper" aria-labelledby="big-questions-title">
    <header>
      <p className="trip-letter__dateline">Only you can see this page</p>
      <h2 id="big-questions-title" className="trip-letter__name">{tripName}</h2>
      <p className="big-questions__lede">Get this trip out of the group chat. Settle these three and it’s real.</p>
    </header>
    {brief ? <div className="big-questions__opening">
      <TripLetterWelcome slug={slug} welcome={brief.welcome} authorName={null} canEdit emptyText="Say why this trip, in a line or two. It goes at the top of every poll." hint="At the top of every poll you share." onSaved={text => setBrief(current => current && { ...current, welcome: text })} />
    </div> : null}
    {failed ? <div role="alert"><p>We couldn’t load your questions. Your trip is saved.</p><button type="button" className="text-action" onClick={() => void load()}>Try again</button></div> : null}
    {!questions && !failed ? <p role="status" className="trip-letter__quiet">Checking your trip…</p> : null}
    {questions ? <ol className="big-questions__list">{questions.map(question => <li key={question.id} aria-current={question.id === nextQuestion?.id ? "step" : undefined}>
      <div className="big-questions__row">
        <div className="big-questions__text">
          <h3>{COPY[question.id].title}</h3>
          {question.decided ? <p className="big-questions__decided">{question.decided}</p>
            : question.poll ? <p>{question.poll.answers === 0 ? "No answers yet" : `${question.poll.answers} ${question.poll.answers === 1 ? "answer" : "answers"}`}</p>
            : <p className="big-questions__help">{COPY[question.id].help}</p>}
        </div>
        <div className="big-questions__actions">
          {deciding !== question.id ? <button type="button" className={question.id === nextQuestion?.id ? "cm-action cm-action--primary" : "cm-action"} onClick={() => setDeciding(question.id)}>{question.decided ? "Change" : "Add"}</button> : null}
          {question.poll ? <>
            <Link className="cm-action" href={`/c/${encodeURIComponent(slug)}/polls/${question.poll.id}/`}>{question.poll.answers ? "See answers" : "View poll"}</Link>
            <button type="button" className="cm-action" onClick={() => void copy(question)}>{copied === question.id ? "Copied" : "Copy link"}</button>
          </> : !question.decided ? <Link className="cm-action" href={`/c/${encodeURIComponent(slug)}/polls/new?template=decide-${question.id}&question=${question.id}`}>Ask your group</Link> : null}
        </div>
      </div>
      {deciding === question.id ? <Decide slug={slug} id={question.id} onCancel={() => setDeciding(null)} onSaved={() => { setDeciding(null); void load(); }} /> : null}
    </li>)}</ol> : null}
    <footer className="big-questions__footer">
      {brief ? <GoingAction slug={slug} emphasized={!nextQuestion} /> : null}
    </footer>
  </section>;
}
