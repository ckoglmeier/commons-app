"use client";
import Link from "next/link";

import type { PollAnswer, PublicPoll } from "@commons/contracts";
import { PollCommunication } from "@/components/poll-communication";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { PollResults } from "@/components/poll-results";
import { PollTypedAnswer } from "@/components/poll-typed-answer";
import { PollHousingFacts, PollPropertyFacts } from "@/components/poll-housing-facts";
import { updatePollChoiceSelection } from "@/lib/poll-selection";
import { pollAnswerLabel, pollResponseError, SavedPollResponseSchema } from "@/lib/poll-response";

type SavedResponse = { receiptToken: string; respondentName: string; answers: PollAnswer[] };

export function PollResponseForm({ token, initialPoll, showHeading = true, offerOwnTrip = false }: { token: string; initialPoll: PublicPoll; showHeading?: boolean; /** Free beta: offer signed-in respondents a quiet way to plan their own trip. Never changes membership or authorization. */ offerOwnTrip?: boolean }) {
  const storageKey = `commons:poll:${initialPoll.id}:response`;
  const [poll, setPoll] = useState(initialPoll);
  const [name, setName] = useState(initialPoll.authenticatedName ?? "");
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [written, setWritten] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, PollAnswer>>({});
  const [receiptToken, setReceiptToken] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [contexts, setContexts] = useState<Record<string, { kind: "preference" | "need" | "note"; text: string }>>({});
  const [contextQuestionId, setContextQuestionId] = useState(initialPoll.questions[0]?.id ?? "");
  const pendingReceipt = useRef<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [review, submitted]);

  function restore(saved: SavedResponse) {
    setName(saved.respondentName);
    setSelected(Object.fromEntries(saved.answers.map(answer => [answer.questionId, answer.optionIds])));
    setWritten(Object.fromEntries(saved.answers.map(answer => [answer.questionId, answer.text ?? ""])));
    setTyped(Object.fromEntries(saved.answers.filter(answer => answer.optionResponses || answer.rankedOptionIds || answer.allocations || answer.abstained).map(answer => { const restored = { ...answer }; delete restored.context; return [answer.questionId, restored]; })));
    setContexts(Object.fromEntries(saved.answers.flatMap(answer => answer.context ? [[answer.questionId, answer.context]] : [])));
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (initialPoll.identityBound) {
        if (initialPoll.ownResponse) {
          restore({ ...initialPoll.ownResponse, receiptToken: "" });
          setSubmitted(true);
        }
        return;
      }
      try {
        const savedValue = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
        const saved = savedValue ? SavedPollResponseSchema.parse(savedValue) : null;
        if (!saved) {
          const pendingValue = JSON.parse(window.localStorage.getItem(`${storageKey}:pending`) ?? "null");
          const pending = pendingValue ? SavedPollResponseSchema.parse(pendingValue) : null;
          if (pending) {
            pendingReceipt.current = pending.receiptToken;
            restore(pending);
          }
          return;
        }
        restore(saved);
        setReceiptToken(saved.receiptToken);
        setSubmitted(true);
      } catch {
        setStorageBlocked(true);
        setError("Couldn’t read the response saved on this device. Nothing on the server changed.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey, initialPoll.identityBound, initialPoll.ownResponse]);

  function choose(questionId: string, optionId: string, mode: "single" | "multiple", exclusive: boolean) {
    setReview(false);
    setSubmitted(false);
    setSelected((current) => {
      if (mode === "single") return { ...current, [questionId]: [optionId] };
      const question = poll.questions.find((item) => item.id === questionId);
      const previous = current[questionId] ?? [];
      const exclusiveIds = question?.kind === "choice" ? question.options.filter((item) => item.exclusive).map((item) => item.id) : [];
      return { ...current, [questionId]: updatePollChoiceSelection(previous, optionId, mode, exclusive, exclusiveIds) };
    });
  }

  const answers: PollAnswer[] = poll.questions.map((question) => ({ ...(question.kind === "choice"
      ? { questionId: question.id, optionIds: selected[question.id] ?? [], text: null }
      : question.kind === "text" ? { questionId: question.id, optionIds: [], text: written[question.id]?.trim() || null }
      : typed[question.id] ?? { questionId: question.id, optionIds: [], text: null }),
      ...(poll.ballotMode === "transparent" && contexts[question.id]?.text.trim() ? { context: { ...contexts[question.id], text: contexts[question.id].text.trim() } } : {}),
    }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || storageBlocked) return;
    const validation = pollResponseError(poll.questions, answers);
    if (validation) { setReview(false); setError(validation); return; }
    if (!review) { setError(""); setReview(true); return; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (!receiptToken && !pendingReceipt.current) {
        const tokenToSave = `${crypto.randomUUID()}${crypto.randomUUID()}`;
        // Persist before sending, so a lost first response can be retried after refresh.
        try {
          if (!poll.identityBound) window.localStorage.setItem(`${storageKey}:pending`, JSON.stringify({
            receiptToken: tokenToSave, respondentName: name.trim(), answers,
          } satisfies SavedResponse));
        } catch {
          throw new Error("This device couldn’t keep a copy for retrying. Nothing was sent. Allow site storage and try again.");
        }
        pendingReceipt.current = tokenToSave;
      }
      const response = await fetch(`/api/v1/polls/${token}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ respondentName: poll.identityBound ? undefined : name, receiptToken, newReceiptToken: receiptToken ? undefined : pendingReceipt.current, answers,
          expectedResponseUpdatedAt: poll.identityBound ? poll.ownResponse?.updatedAt ?? null : undefined }),
      });
      const payload = await response.json();
      if (!response.ok && payload.savedResponse) {
        const saved = SavedPollResponseSchema.parse(payload.savedResponse);
        setReceiptToken(saved.receiptToken);
        restore(saved);
        setReview(false);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(saved));
          window.localStorage.removeItem(`${storageKey}:pending`);
        } catch { /* Keep the recovered receipt usable in this page. */ }
      }
      if (!response.ok) throw new Error(payload.error ?? "Response not saved. Try again.");
      const saved: SavedResponse = { receiptToken: payload.receiptToken, respondentName: name.trim(), answers };
      setReceiptToken(payload.receiptToken);
      setPoll(payload.poll);
      if (payload.poll.identityBound) setName(payload.poll.ownResponse?.respondentName ?? payload.poll.authenticatedName ?? "Signed-in participant");
      setSubmitted(true);
      try {
        if (!poll.identityBound) {
          window.localStorage.setItem(storageKey, JSON.stringify(saved));
          window.localStorage.removeItem(`${storageKey}:pending`);
        }
      } catch { /* The committed receipt remains usable in this open page. */ }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Response not saved. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (poll.status !== "open") return <div className="public-poll-body"><span className="view-kicker">Poll closed</span><h1>{poll.title}</h1>{poll.decision ? <section className="poll-result-question"><h2>What was decided</h2><p>{poll.decision.summary}</p><p>{poll.decision.approvedByName} approved this on {new Date(poll.decision.approvedAt).toLocaleDateString("en-US")}.</p><p>{poll.decision.target === "plan_idea" ? "Added to the event’s Plan as an idea. Nothing was booked and no one’s attendance was confirmed." : "Saved here for people in this poll. Plans and attendance didn’t change."}</p></section> : <p className="public-poll-lede">Voting is closed. Responses don’t confirm a plan or who’s coming.</p>}<PollResults poll={poll} /></div>;
  if (submitted) return <div className="public-poll-body"><span className="view-kicker" role="status">Response saved</span><h1>Thanks, {name.trim()}.</h1><p className="public-poll-lede">This isn’t an RSVP. {poll.identityBound ? "Come back with this account to edit while voting is open." : "Come back on this device to edit while voting is open."}</p><button className="poll-revise" type="button" onClick={() => { setSubmitted(false); setReview(false); }}>Edit my response</button><PollResults poll={poll} />{offerOwnTrip && poll.identityBound ? <p className="poll-own-trip"><Link href="/new" data-analytics-event="participant_trip_start_clicked" data-analytics-detail="poll_receipt">Plan your own trip</Link></p> : null}</div>;

  if (review) return <form className="public-poll-body" onSubmit={submit}>
    <span className="view-kicker">Review your response</span><h1>{poll.title}</h1><p>Responding as {name}. This isn’t an RSVP.</p>
    {poll.questions.map(question => { const answer = answers.find(item => item.questionId === question.id); return <section className="poll-result-question" key={question.id}><h2>{question.prompt}</h2><p>{pollAnswerLabel(question, answer)}</p>{answer?.context ? <p>{answer.context.text}</p> : null}</section>; })}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="poll-action-row poll-editor-actions"><button className="cm-action" type="button" disabled={busy} onClick={() => setReview(false)}>Edit response</button>
    <button className="cm-action cm-action--primary" type="submit" disabled={busy}>{busy ? "Saving…" : receiptToken || poll.ownResponse ? "Confirm updated response" : "Confirm response"}</button></div>
  </form>;

  return <form className="public-poll-body" onSubmit={submit}>
    {showHeading ? <><span className="view-kicker">Help shape this trip</span><h1>{poll.title}</h1></> : null}
    {poll.superseded ? <p role="status">This poll was replaced. Its responses are kept but don’t count toward the new one. {poll.superseded.replacementPublicId ? <a href={`/c/poll/${poll.superseded.replacementPublicId}`}>Open the new poll</a> : "The new poll isn’t ready yet."}</p> : null}
    {poll.communicationMode === "legacy" && poll.communication ? <PollCommunication message={poll.communication} /> : null}
    {poll.tripBrief && (poll.tripBrief.welcome || poll.tripBrief.decideBy || poll.tripBrief.roughCost) ? <section className="public-poll-brief" aria-label="About this trip">
      {poll.tripBrief.welcome ? <><p className="public-poll-brief__welcome">{poll.tripBrief.welcome}</p><p className="public-poll-brief__sign">{poll.tripBrief.organizerName}, organizing</p></> : null}
      {poll.tripBrief.decideBy || poll.tripBrief.roughCost ? <p className="public-poll-brief__facts">{[poll.tripBrief.decideBy ? `Answers by ${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${poll.tripBrief.decideBy}T00:00:00Z`))}` : null, poll.tripBrief.roughCost ? `${poll.tripBrief.roughCost} (organizer’s estimate)` : null].filter(Boolean).join(" · ")}</p> : null}
    </section> : null}
    {poll.intro ? <p className="public-poll-lede">{poll.intro}</p> : null}
    {poll.identityBound ? <p className="poll-name">Responding as <strong>{poll.authenticatedName ?? "your signed-in account"}</strong>. {poll.ballotMode === "secret" ? "Choices aren’t tied to names. Totals appear after voting closes." : "Your response is tied to your signed-in account."}</p> : <label className="poll-name"><strong>Your name</strong><input value={name} onChange={event => { setReview(false); setName(event.target.value); }} placeholder="First name" maxLength={80} required /><small>{poll.questions.every(q => q.organizerOnly || (q.kind === "text" && q.foodField)) ? "" : poll.ballotMode === "secret" ? "Choices aren’t tied to names. Totals appear after voting closes." : poll.identityBound ? "Selected participants and organizers can see your name and choices." : "Everyone in the event can see your name and choices."} Names are self-reported.</small></label>}

    <div className="public-poll-response-layout"><div className="public-poll-questions">
    {poll.questions.map(question => <section className="fieldnotes-response-question" key={question.id}>
      {question.kind === "choice" ? <fieldset className="poll-question">
        <legend className={question.prompt === poll.title ? "sr-only" : undefined}>{question.prompt}</legend><p>{question.selectionMode === "multiple" ? "Choose all that work." : "Choose one."} {!question.required ? "Optional." : ""}</p>
        {question.availability?.mode === "times" ? <p>All times in {question.availability.timezone}.</p> : null}
        <div className={question.availability ? "poll-availability-choices" : undefined}>{question.options.map(option => <div className="poll-option-group" key={option.id}><label className="poll-option">
          <input type={question.selectionMode === "multiple" ? "checkbox" : "radio"} name={question.id} checked={(selected[question.id] ?? []).includes(option.id)} onChange={() => choose(question.id, option.id, question.selectionMode, option.exclusive)} />
          <span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
        </label>{option.housing ? <PollHousingFacts housing={option.housing} compact /> : null}{option.property ? <PollPropertyFacts property={option.property} /> : null}{option.url ? <a className="poll-option-source" href={option.url} target="_blank" rel="noreferrer">View option: {option.label}</a> : null}</div>)}</div>
      </fieldset> : question.kind === "text" ? <label className="poll-text-question"><strong>{question.prompt}</strong>{!question.required ? <small>Optional</small> : null}<textarea value={written[question.id] ?? ""} onChange={event => { setReview(false); setWritten(current => ({ ...current, [question.id]: event.target.value })); }} rows={3} maxLength={1000} required={question.required} /></label>
        : <PollTypedAnswer question={question} answer={typed[question.id]} onChange={answer => { setReview(false); setTyped(current => ({ ...current, [question.id]: answer })); }} />}
    </section>)}
    </div>
    {poll.ballotMode === "transparent" && poll.questions.length && !poll.questions.every(q => q.kind === "text" && q.foodField) ? <section className="public-poll-context" aria-label="Optional comments">
      {poll.questions.length > 1 ? <label className="fieldnotes-field"><span>About</span><select value={contextQuestionId} onChange={event => setContextQuestionId(event.target.value)}>{poll.questions.map(question => <option value={question.id} key={question.id}>{question.prompt}{contexts[question.id]?.text.trim() ? " · comment added" : ""}</option>)}</select></label> : null}
      <label className="fieldnotes-field"><span>Anything else? (optional)</span><textarea value={contexts[contextQuestionId]?.text ?? ""} maxLength={1000} rows={2} onChange={event => setContexts(current => ({ ...current, [contextQuestionId]: { kind: current[contextQuestionId]?.kind ?? "note", text: event.target.value } }))} /></label>
    </section> : null}
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="poll-action-row poll-editor-actions"><button className="cm-action cm-action--primary" type="submit" disabled={busy || storageBlocked || (!poll.identityBound && !name.trim())}>Review response</button></div>
  </form>;
}
