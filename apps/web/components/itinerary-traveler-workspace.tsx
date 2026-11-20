"use client";
import { useEffect, useRef, useState } from "react";
import { PublicPollSchema, SubmitPollResponseRequestSchema, type PublicPoll, type ItineraryPollFeedback, type PollAnswer, type ItineraryPollItem } from "@commons/contracts";
import { itineraryQuestion } from "@/lib/itinerary-workshop";
import { SavedPollResponseSchema } from "@/lib/poll-response";
import { ItineraryMessage } from "./itinerary-message";
import { ItineraryDocument } from "./itinerary-document";
import { personFacingError } from "@/lib/person-facing-error";

const emptyFeedback: ItineraryPollFeedback = { comments: [], interests: [] };
export function ItineraryTravelerWorkspace({ initialPoll }: { initialPoll: PublicPoll }) {
  const question = itineraryQuestion(initialPoll.questions)!;
  const pieces = question.itinerary.feedbackMode === "pieces";
  const [poll, setPoll] = useState(initialPoll);
  const own = initialPoll.ownResponse?.answers.find(answer => answer.questionId === question.id);
  const [name, setName] = useState(initialPoll.ownResponse?.respondentName ?? initialPoll.authenticatedName ?? "");
  const [answer, setAnswer] = useState<PollAnswer>(own ?? { questionId: question.id, optionIds: [], text: null, itineraryFeedback: emptyFeedback });
  const [text, setText] = useState(""), [target, setTarget] = useState<string | null>(null), [prefix, setPrefix] = useState("");
  const [pane, setPane] = useState<"conversation" | "itinerary">(pieces ? "itinerary" : "conversation");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const [ready, setReady] = useState(initialPoll.identityBound), [uncertain, setUncertain] = useState(false);
  const receipt = useRef<string | null>(null), pending = useRef<{ body: string; answer: PollAnswer; comment: boolean } | null>(null);
  const responseUpdatedAt=useRef<string|null>(initialPoll.ownResponse?.updatedAt??null);
  const textarea = useRef<HTMLTextAreaElement>(null), nameInput = useRef<HTMLInputElement>(null), writing = useRef(false);
  const focusAfterSave = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (busy) return;
    const target = focusAfterSave.current;
    focusAfterSave.current = null;
    // Disabling a saving control can drop browser focus to body. Restore it
    // after controls are enabled, without interrupting a person who moved on.
    if (target?.isConnected && typeof document !== "undefined" && document.activeElement === document.body && !target.matches(":disabled")) target.focus();
  }, [busy]);
  const storageKey = `commons:poll:${poll.id}:response`;
  const closed = poll.status !== "open" || Boolean(poll.superseded);
  const disabled = busy || !ready || closed || uncertain;
  const feedback = answer.itineraryFeedback ?? emptyFeedback;

  useEffect(() => {
    if (initialPoll.identityBound) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      const saved = raw ? SavedPollResponseSchema.parse(JSON.parse(raw)) : null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrates the existing device-bound response receipt from external storage after SSR.
      if (saved) { receipt.current = saved.receiptToken; responseUpdatedAt.current=saved.updatedAt??null; setName(saved.respondentName); setAnswer(saved.answers.find(value => value.questionId === question.id) ?? answer); }
      const pendingRaw = window.localStorage.getItem(`${storageKey}:itinerary-pending`);
      if (pendingRaw) { const stored=JSON.parse(pendingRaw); const command=SubmitPollResponseRequestSchema.parse(JSON.parse(stored.body)); pending.current={body:stored.body,answer:command.answers.find(value=>value.questionId===question.id)!,comment:Boolean(stored.comment)}; setName(command.respondentName); setUncertain(true); setError("Your last response may have saved. Retry it to check before making another change."); }
      setReady(true);
    } catch { setError("This device could not read its saved response. Reload after allowing site storage."); }
    // Account responses come from the server. Link responses use the existing device receipt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, initialPoll.identityBound, question.id]);

  async function save(next: PollAnswer, comment = false, retry = false) {
    if (writing.current || closed || !ready) return;
    if (!poll.identityBound && !name.trim()) { setError("Add your name first."); nameInput.current?.focus(); return; }
    if (typeof document !== "undefined") {
      focusAfterSave.current = comment || (retry && pending.current?.comment)
        ? textarea.current
        : document.activeElement === document.body ? null : document.activeElement as HTMLElement;
    }
    writing.current = true; setBusy(true); setError(""); setStatus("");
    let received = false, sent=false;
    try {
      if (!retry) {
        const newReceiptToken = receipt.current ? undefined : `${crypto.randomUUID()}${crypto.randomUUID()}`;
        const body = JSON.stringify({ respondentName: poll.identityBound ? undefined : name.trim(), receiptToken: receipt.current, newReceiptToken, answers: [next], expectedResponseUpdatedAt: poll.identityBound ? poll.ownResponse?.updatedAt ?? null : responseUpdatedAt.current });
        pending.current = { body, answer: next, comment };
        if (!poll.identityBound) window.localStorage.setItem(`${storageKey}:itinerary-pending`, JSON.stringify(pending.current));
      }
      const work = pending.current;
      if (!work) throw new Error("There is no response to retry.");
      sent=true;
      const response = await fetch(`/api/v1/polls/${poll.publicId}/responses`, { method: "POST", headers: { "Content-Type": "application/json" }, body: work.body });
      const payload = await response.json(); received = response.status < 500;
      if (!response.ok) {
        if (payload.savedResponse) {
          const saved = SavedPollResponseSchema.parse(payload.savedResponse); receipt.current = saved.receiptToken;
          responseUpdatedAt.current=saved.updatedAt??null;
          setName(saved.respondentName); setAnswer(saved.answers.find(value => value.questionId === question.id) ?? answer);
          if (!poll.identityBound) window.localStorage.setItem(storageKey, JSON.stringify(saved));
        }
        throw new Error(payload.error ?? "Your response could not be saved.");
      }
      const savedPoll = PublicPollSchema.parse(payload.poll);
      receipt.current = payload.receiptToken; setPoll(savedPoll);
      const authoritative=savedPoll.identityBound ? savedPoll.ownResponse?.answers.find(value=>value.questionId===question.id) : undefined;
      setAnswer(authoritative??work.answer);
      if(savedPoll.identityBound && savedPoll.ownResponse) setName(savedPoll.ownResponse.respondentName);
      responseUpdatedAt.current=payload.responseUpdatedAt??savedPoll.ownResponse?.updatedAt??null;
      if (!poll.identityBound) window.localStorage.setItem(storageKey, JSON.stringify({ receiptToken: payload.receiptToken, respondentName: name.trim(), answers: [work.answer],updatedAt:responseUpdatedAt.current }));
      if (work.comment) { setText(""); setTarget(null); setPrefix(""); }
      setStatus("Saved for the organizer."); setUncertain(false);
    } catch (cause) {
      if (!sent) {pending.current=null;setUncertain(false);}
      else if (!received && pending.current) setUncertain(true);
      setError(personFacingError(cause, "Your response could not be saved."));
    } finally {
      if (received) { pending.current = null; setUncertain(false); if (!poll.identityBound) { try { window.localStorage.removeItem(`${storageKey}:itinerary-pending`); } catch { /* Receipt remains in memory. */ } } }
      writing.current = false; setBusy(false);
    }
  }
  function focusComment(item: ItineraryPollItem) {
    setTarget(item.id); setPrefix(""); setPane("conversation");
    // Keep an unsent comment intact when moving between item controls.
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(textarea.current.value.length, textarea.current.value.length); });
  }
  function focusPrompt(prompt: string) {
    setTarget(null); setPrefix(`${prompt}\n`); setText(`${prompt}\n`); setPane("conversation");
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(textarea.current.value.length, textarea.current.value.length); });
  }
  const selectedIndex = question.options.findIndex(option => answer.optionIds.includes(option.id));
  const targetDay = question.itinerary.days.find(day => day.items.some(item => item.id === target));
  const targetItem = targetDay?.items.find(item => item.id === target);
  const composerLabel = target ? `Comment about ${targetItem?.title ?? "this activity"}${targetDay ? ` on ${targetDay.label}` : ""}` : selectedIndex === 1 ? "What would you change?" : selectedIndex === 2 ? "What doesn’t work for you?" : "Add a comment";
  return <div className={pieces ? "itinerary-participant-frame cm-document-canvas" : undefined}><div className={`itinerary-participant${pieces ? " itinerary-participant--pieces" : ""}`}>
    <header><span className="view-kicker">{poll.event.name}</span><h1>{pieces ? "Review the itinerary" : "Review the itinerary"}</h1></header>
    {poll.superseded ? <p role="status">This version has been replaced. {poll.superseded.replacementPublicId ? <a href={`/c/poll/${poll.superseded.replacementPublicId}`}>Respond to the updated itinerary</a> : "The organizer is preparing an updated itinerary."}</p> : null}
    {pieces ? <div className="itinerary-participant-identity">{poll.identityBound ? <p>Responding as <strong>{poll.authenticatedName ?? "your signed-in account"}</strong>.</p> : <label>Your name<input ref={nameInput} value={name} onChange={event => setName(event.target.value)} maxLength={80} disabled={disabled} autoComplete="given-name" /></label>}<p className="review-caption">Add comments or suggestions for the organizer. Answer any specific questions where you have a preference. {poll.identityBound ? "Your response is tied to your signed-in account." : "Names are self-reported; use this device to update your response."}</p></div> : null}
    <div className="itinerary-feedback-status">
        {closed ? <p role="status">This poll is closed. Your saved feedback remains with this version.</p> : null}
        {status ? <p role="status">{status}</p> : null}{error ? <p role="alert" className="form-error">{error}</p> : null}
        {uncertain ? <button className="cm-action" disabled={busy} onClick={() => void save(pending.current?.answer ?? answer, false, true)}>Retry saved response</button> : null}
    </div>
    <div className="itinerary-mobile-switch"><button className="cm-action" aria-pressed={pane === "conversation"} onClick={() => setPane("conversation")}>Conversation</button><button className="cm-action" aria-pressed={pane === "itinerary"} onClick={() => setPane("itinerary")}>Itinerary</button></div>
    <div className="itinerary-participant-columns">
      <section className={`itinerary-participant-document${pieces ? " cm-document-paper" : ""}`} aria-label="Shared itinerary" data-mobile-hidden={pane !== "itinerary"}>
        {pieces ? <ItineraryMessage data={poll} onPrompt={focusPrompt}><ItineraryDocument showTitle={!pieces} itinerary={question.itinerary} disabled={disabled} votes={Object.fromEntries((feedback.votes ?? []).map(vote => [vote.itemId,vote.optionId]))} onVote={(itemId,optionId) => void save({ ...answer, itineraryFeedback:{...feedback,votes:[...(feedback.votes ?? []).filter(vote => vote.itemId !== itemId),{itemId,optionId}]} })} onComment={focusComment} commentCounts={Object.fromEntries(feedback.comments.filter(comment => comment.itemId).map(comment => [comment.itemId!, feedback.comments.filter(row => row.itemId === comment.itemId).length]))} interest={Object.fromEntries(feedback.interests.map(interest => [interest.itemId, interest.choice]))} onInterest={(id, choice) => void save({ ...answer, itineraryFeedback: { ...feedback, interests: [...feedback.interests.filter(interest => interest.itemId !== id), { itemId: id, choice }] } })} /></ItineraryMessage> : <ItineraryDocument showTitle={!pieces} itinerary={question.itinerary} disabled={disabled} votes={Object.fromEntries((feedback.votes ?? []).map(vote => [vote.itemId,vote.optionId]))} onVote={(itemId,optionId) => void save({ ...answer, itineraryFeedback:{...feedback,votes:[...(feedback.votes ?? []).filter(vote => vote.itemId !== itemId),{itemId,optionId}]} })} onComment={focusComment} commentCounts={Object.fromEntries(feedback.comments.filter(comment => comment.itemId).map(comment => [comment.itemId!, feedback.comments.filter(row => row.itemId === comment.itemId).length]))} interest={Object.fromEntries(feedback.interests.map(interest => [interest.itemId, interest.choice]))} onInterest={(id, choice) => void save({ ...answer, itineraryFeedback: { ...feedback, interests: [...feedback.interests.filter(interest => interest.itemId !== id), { itemId: id, choice }] } })} />}
      </section>
      <section className={`itinerary-conversation${pieces ? " cm-document-panel" : ""}`} aria-label={pieces ? "Your comments to the organizer" : "Your conversation"} data-mobile-hidden={pane !== "conversation"}>
        <header className={`itinerary-feedback-header${pieces ? " cm-document-panel-header" : ""}`}><h2>Comments</h2><p>{question.itinerary.feedbackMode === "pieces" ? "Your comments go to the organizer." : "Choose a response, then add anything the organizer should know."}</p></header>
        {!pieces && !poll.identityBound ? <label>Your name<input ref={nameInput} value={name} onChange={event => setName(event.target.value)} maxLength={80} disabled={disabled} autoComplete="given-name" /></label> : null}
        {!pieces ? <p className="review-caption">The organizer sees your response and comments. {poll.identityBound ? "Your response is tied to your signed-in account." : "Names on this link are self-reported; use this device to update your response."}</p> : null}
        {question.itinerary.feedbackMode !== "pieces" ? <div className="itinerary-decisions" role="group" aria-label="Your response to the itinerary">{question.options.map((option, index) => <button key={option.id} className="cm-action itinerary-decision" disabled={disabled} aria-pressed={answer.optionIds.includes(option.id)} onClick={() => { void save({ ...answer, optionIds: [option.id] }); if (index > 0) requestAnimationFrame(() => textarea.current?.focus()); }}>{answer.optionIds.includes(option.id) ? "✓ " : ""}{option.label}</button>)}</div> : null}
        <div className="itinerary-chat-log">{feedback.comments.map(comment => {
          const day = question.itinerary.days.find(day => day.items.some(item => item.id === comment.itemId));
          const item = day?.items.find(item => item.id === comment.itemId);
          return <div className="itinerary-chat-message" key={comment.id}><strong>{name}</strong>{item ? <small>{item.title} · {day!.label}</small> : null}<p>{comment.text}</p></div>;
        })}</div>
        <form onSubmit={event => { event.preventDefault(); if (!text.trim() || (prefix && text.trim() === prefix.trim())) return; void save({ ...answer, itineraryFeedback: { ...feedback, comments: [...feedback.comments, { id: crypto.randomUUID(), itemId: target, text: text.trim() }] } }, true); }}>
          <label>{composerLabel}<textarea ref={textarea} placeholder={targetItem?.kind==="meal" && !targetItem.venue ? "Have a lunch or dinner spot in mind?" : "Write a comment"} value={text} onChange={event => setText(event.target.value)} rows={3} maxLength={1000} disabled={disabled} /></label>
          <div className="itinerary-comment-actions">{target ? <button className="cm-action itinerary-general-comment" type="button" disabled={disabled} onClick={() => { setTarget(null); setPrefix(""); }}>General comment</button> : null}
          <button className="cm-action cm-action--primary" disabled={disabled || !text.trim() || Boolean(prefix && text.trim() === prefix.trim())}>{busy ? "Saving…" : "Send"}</button></div>
        </form>

      </section>

    </div>
  </div></div>;
}
