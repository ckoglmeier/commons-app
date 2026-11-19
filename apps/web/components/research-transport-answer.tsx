"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { ResearchWorkspaceAnswerReview, ResearchWorkspaceHistory } from "../lib/server/research-workspace-service";
import { matchesResearchAnswerReceipt, readResearchAnswerPending, researchAnswerKey, transportAnswerDraftSchema, type ResearchAnswerPending } from "../lib/research-answer-pending";
import { sameTransportAnswers, transportAnswerLabels, unknownTransportAnswers, type TransportAnswers } from "../lib/research-transport-answers";

async function json<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Your answers weren’t confirmed. Check the request before trying again.");
  return data as T;
}
/** Typed answers are research inputs, not canonical traveler or booking facts.
 * The host keys this component by trip/actor/goal so late work cannot cross scopes. */
export function ResearchTransportAnswer({ slug, actorId, history, disabled, onApplied }: {
  slug: string; actorId: string; history: ResearchWorkspaceHistory; disabled: boolean; onApplied: () => void;
}) {
  const endpoint = `/api/v1/commons/${encodeURIComponent(slug)}/coordinator/research-workspace/`;
  const journal = researchAnswerKey(slug, actorId, history.goalId), draftKey = `${journal}:draft`, id = useId();
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLButtonElement>(null), host = useRef<HTMLDivElement>(null);
  const alive = useRef(true), inFlight = useRef(false);
  const [answers, setAnswers] = useState<TransportAnswers>(history.transportAnswers ?? unknownTransportAnswers);
  const [review, setReview] = useState<ResearchWorkspaceAnswerReview | null>(null);
  const [pending, setPending] = useState<ResearchAnswerPending | null>(null);
  const [obsoleteCommand, setObsoleteCommand] = useState<string | null>(null);
  const [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => {
    alive.current = true;
    const timer = setTimeout(() => {
      try {
        const record = readResearchAnswerPending(localStorage.getItem(journal));
        if (record && record.body.goalId !== history.goalId) throw new Error();
        setPending(record);
        const saved = localStorage.getItem(draftKey);
        if (record) setAnswers(record.body.answers);
        else if (saved) setAnswers(transportAnswerDraftSchema.parse(JSON.parse(saved)));
      } catch { setBlocked(true); setNotice("Saved answers couldn’t be read. Check this research task before sending another update."); }
      setReady(true);
    }, 0);
    return () => { alive.current = false; clearTimeout(timer); };
  }, [journal, draftKey, history.goalId]);
  useEffect(() => { if (ready && !blocked) try { localStorage.setItem(draftKey, JSON.stringify(answers)); } catch { /* Sending separately requires a durable request. */ } }, [answers, ready, blocked, draftKey]);
  const run = async (fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice("");
    try { await fn(); } catch (error) { if (alive.current) setNotice(error instanceof Error ? error.message : "Your answers weren’t confirmed. Check the request."); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const recover = async (record: ResearchAnswerPending) => {
    const lookup = async () => json<{ history: ResearchWorkspaceHistory | null }>(await fetch(`${endpoint}?commandId=${record.body.commandId}`, { cache: "no-store" }));
    let { history: receipt } = await lookup();
    if (!receipt) {
      const { history: current } = await json<{ history: ResearchWorkspaceHistory | null }>(await fetch(`${endpoint}?goalId=${record.body.goalId}`, { cache: "no-store" }));
      if (current?.goalId === record.body.goalId && (current.currentGoalRevision > record.body.expectedRevision || current.goalLifecycle === "cancelled")) {
        // Read again AFTER observing an irreversible revision/cancellation fence.
        // If an in-flight request committed before that fence, its receipt wins.
        receipt = (await lookup()).history;
        if (!receipt) {
          if (alive.current) { setObsoleteCommand(record.body.commandId); setNotice("The task changed before these answers were saved. Keep your answers and review them against the latest task."); }
          return "obsolete" as const;
        }
      }
      if (!receipt) { if (alive.current) setNotice("No receipt yet. You can retry the same saved answers."); return "missing" as const; }
    }
    if (!matchesResearchAnswerReceipt(record, receipt)) throw new Error("The receipt didn’t match these answers. Nothing else will be sent.");
    // A late tab must never clear a newer journal written by another tab.
    const stored = readResearchAnswerPending(localStorage.getItem(journal));
    if (stored?.body.commandId === record.body.commandId) localStorage.removeItem(journal);
    if (alive.current) {
      if (stored && stored.body.commandId !== record.body.commandId) { setPending(stored); setNotice("Another answer request is saved on this device. Check it before continuing."); return "saved" as const; }
      setPending(null); setObsoleteCommand(null); setReview(null); setNotice("Answers saved. This research task will use your updated details.");
      dialog.current?.close(); onApplied();
    }
    return "saved" as const;
  };
  const discardObsolete = (record: ResearchAnswerPending) => void run(async () => {
    if (await recover(record) !== "obsolete") return;
    const stored = readResearchAnswerPending(localStorage.getItem(journal));
    if (stored?.body.commandId !== record.body.commandId) throw new Error("The saved request changed. Check it again.");
    localStorage.removeItem(journal);
    if (alive.current) { setPending(null); setObsoleteCommand(null); setReview(null); onApplied(); setNotice("Your answers are still here. Review them against the updated task before applying."); }
  });
  const send = async (record: ResearchAnswerPending) => {
    await json(await fetch(`${endpoint}?action=answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record.body) }));
    await recover(record);
  };
  const preview = () => void run(async () => {
    if (!history.reviewCommandId) return;
    const next = await json<ResearchWorkspaceAnswerReview>(await fetch(`${endpoint}?action=prepare-answer`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        goalId: history.goalId, expectedRevision: history.currentGoalRevision, expectedReviewCommandId: history.reviewCommandId, answers,
      }),
    }));
    if (alive.current) setReview(next);
  });
  const approve = () => void run(async () => {
    if (!review || pending || blocked || disabled || !history.canRefineTransport || review.availability !== "fixture_ready") return;
    if (review.request.expectedRevision !== history.currentGoalRevision || review.request.expectedReviewCommandId !== history.reviewCommandId) throw new Error("This task changed. Review your answers again.");
    const stored = readResearchAnswerPending(localStorage.getItem(journal));
    if (stored) { setPending(stored); setNotice("A saved request needs to be checked first."); return; }
    const record: ResearchAnswerPending = { version: 1, body: { ...review.request, expectedSourceFingerprint: review.sourceFingerprint, commandId: crypto.randomUUID() } };
    localStorage.setItem(journal, JSON.stringify(record)); setPending(record);
    await send(record);
  });
  const unchanged = sameTransportAnswers(answers, history.transportAnswers ?? unknownTransportAnswers);
  const change = (next: TransportAnswers) => { setAnswers(next); setReview(null); setNotice(""); };
  const restoreFocus = () => requestAnimationFrame(() => {
    (opener.current && !opener.current.disabled ? opener.current : host.current)?.focus();
  });
  return <div ref={host} tabIndex={-1} className="research-workspace-artifact">
    {history.canRefineTransport || pending ? <button type="button" className="cm-action" ref={opener} disabled={!ready || busy || disabled || blocked}
      onClick={() => { setReview(null); dialog.current?.showModal(); }}>{pending ? "Check updated research answers" : "Update transport details"}</button> : null}
    <p role="status">{notice}</p>
    <dialog ref={dialog} className="research-workspace-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); dialog.current?.close(); }} onClose={restoreFocus}>
      <header><h2 id={`${id}-title`}>Update transport details</h2><button type="button" className="cm-action" onClick={() => dialog.current?.close()}>Close transport details</button></header>
      <div className="research-workspace-form" aria-busy={busy}>
        <p>{history.scope.title} · {history.scope.partySize} travelers</p>
        <p>Keep building this comparison. Leave a field blank if you’re not sure; enter 0 if no one will drive.</p>
        <fieldset disabled={busy || Boolean(pending) || disabled}><legend>Willing drivers</legend>
          {transportAnswerLabels.map(([key, label]) => <label key={key}>{label}<input type="number" min={0} max={Math.min(20, history.scope.partySize)} step={1} inputMode="numeric"
            value={answers.drivers[key] ?? ""} onChange={event => change({ ...answers, drivers: { ...answers.drivers, [key]: event.target.value === "" ? null : Number(event.target.value) } })} /></label>)}
        </fieldset>
        <label>Bags for the group<input type="number" min={0} max={200} step={1} inputMode="numeric" disabled={busy || Boolean(pending) || disabled}
          value={answers.luggagePieces ?? ""} onChange={event => change({ ...answers, luggagePieces: event.target.value === "" ? null : Number(event.target.value) })} /></label>
        {pending ? <section aria-label="Unconfirmed research answers" className="research-workspace-recovery"><h3>Check your saved answers</h3><p>The original request is saved on this device. Check it before sending again.</p>
          <button type="button" className="cm-action" disabled={busy} onClick={() => void run(async () => { await recover(pending); })}>Check answer status</button>
          {obsoleteCommand === pending.body.commandId ? <button type="button" className="cm-action" disabled={busy || disabled} onClick={() => discardObsolete(pending)}>Keep answers and review latest task</button>
            : <button type="button" className="cm-action" disabled={busy || disabled} onClick={() => void run(async () => { if (await recover(pending) === "missing") await send(pending); })}>Retry the same answers</button>}
        </section> : <button type="button" className="cm-action" disabled={busy || disabled || blocked || !history.canRefineTransport || unchanged || !transportAnswerDraftSchema.safeParse(answers).success}
          onClick={preview}>Review updated answers</button>}
        {review && !pending ? <section className="research-workspace-preview" aria-label="Reviewed transport answers"><h3>Your updated answers</h3><p>{review.summary}</p>
          <p>This continues the same research task. It doesn’t change saved travel plans or book anything.</p>
          {review.availability !== "fixture_ready" ? <p>Research is unavailable right now. Your answers are still here.</p> : null}
          <button type="button" className="cm-action cm-action--primary" disabled={busy || disabled || blocked || review.availability !== "fixture_ready" || !history.canRefineTransport} onClick={approve}>Apply answers and continue</button>
        </section> : null}
        <p role="status">{notice}</p>
      </div>
    </dialog>
  </div>;
}
