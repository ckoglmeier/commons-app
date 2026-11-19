"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ResearchWorkspaceChoices, ResearchWorkspaceReview, ResearchWorkspaceHistory, ResearchWorkspaceRequest } from "../lib/server/research-workspace-service";
import { readResearchPending, researchPendingKey, type ResearchPending } from "../lib/research-workspace-pending";
import { researchReadIsCurrent } from "../lib/research-workspace-read";
import { ResearchDecisionComparisonView } from "./research-decision-comparison";
import { ResearchTransportAnswer } from "./research-transport-answer";

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Research couldn’t reload. Your draft is still here.");
  return data as T;
}
const factRef = (fact: { id: string; version: string | number }) => ({ id: fact.id, version: fact.version });
type Draft = { kind: "winery" | "transport"; title: string; names: string; queries: string; date: string; people: string[]; stay: string; arrival: string; departure: string };
const emptyDraft: Draft = { kind: "winery", title: "Compare winery options", names: "", queries: "", date: "", people: [], stay: "", arrival: "", departure: "" };
/** Mounted in the conversation, never a permanent right rail. The dialog stays
 * mounted when closed so opening research doesn't clear composer or form edits. */
export function ResearchWorkspace({ slug, actorId, goalId, disabled = false, onStarted, onQuestion, intro = "card" }: {
  slug: string; actorId: string; goalId?: string; disabled?: boolean; onStarted?: (goalId: string) => void; onQuestion: (question: string) => void;
  /** "link": a one-line entry once the conversation has started, so the starter card doesn't sit above every chat. */
  intro?: "card" | "link";
}) {
  const endpoint = `/api/v1/commons/${encodeURIComponent(slug)}/coordinator/research-workspace/`, id = useId();
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLButtonElement>(null), host = useRef<HTMLElement>(null), mounted = useRef(true), busyRef = useRef(false);
  const focusRestoration = useRef(false);
  const journal = researchPendingKey(slug, actorId), draftKey = `${journal}:draft`;
  const [draft, setDraft] = useState<Draft>(emptyDraft), [choices, setChoices] = useState<ResearchWorkspaceChoices | null>(null);
  const [review, setReview] = useState<ResearchWorkspaceReview | null>(null), [history, setHistory] = useState<ResearchWorkspaceHistory | null>(null);
  const [pending, setPending] = useState<ResearchPending | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [followGoal, setFollowGoal] = useState<string | null>(null);
  const activeGoal = goalId ?? followGoal;
  const [journalBlocked, setJournalBlocked] = useState(false), [restored, setRestored] = useState(Boolean(goalId));
  const readScope = useRef(`${endpoint}:${goalId ?? "none"}`), readSequence = useRef(0), lastAppliedRead = useRef(0);
  useEffect(() => { readScope.current = `${endpoint}:${activeGoal ?? pending?.body.commandId ?? "none"}`; lastAppliedRead.current = ++readSequence.current; }, [endpoint, activeGoal, pending?.body.commandId]);
  const readHistory = async () => {
    const originScope = readScope.current;
    const sequence = ++readSequence.current;
    const suffix = activeGoal ? `goalId=${activeGoal}` : pending ? `commandId=${pending.body.commandId}` : null;
    if (!suffix) return;
    const result = await responseJson<{ history: ResearchWorkspaceHistory | null }>(await fetch(`${endpoint}?${suffix}`, { cache: "no-store" }));
    const matches = !result.history || (activeGoal ? result.history.goalId === activeGoal : result.history.reviewCommandId === pending?.body.commandId);
    if (!matches) throw new Error("Research status did not match this request. The original request is still saved.");
    if (mounted.current && researchReadIsCurrent(originScope, readScope.current, sequence, lastAppliedRead.current)) {
      lastAppliedRead.current = sequence; setHistory(result.history);
      if (!activeGoal && result.history) setFollowGoal(result.history.goalId);
    }
    return result.history;
  };
  useEffect(() => {
    mounted.current = true;
    if (goalId) return () => { mounted.current = false; };
    const timer = setTimeout(() => {
      try {
        setPending(readResearchPending(localStorage.getItem(journal)));
        const raw = localStorage.getItem(draftKey);
        if (raw) { const saved = JSON.parse(raw); if (typeof saved.title === "string" && typeof saved.queries === "string" && Array.isArray(saved.people) && ["winery", "transport"].includes(saved.kind)) setDraft(saved); }
      } catch { setJournalBlocked(true); setNotice("The saved research request couldn’t be read. Check existing tasks before starting anything new."); }
      setRestored(true);
    }, 0);
    return () => { clearTimeout(timer); mounted.current = false; };
  }, [journal, draftKey, goalId]);
  useEffect(() => { if (!goalId && restored && !journalBlocked) try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* Sending requires its own durable local journal below. */ } }, [draft, draftKey, goalId, restored, journalBlocked]);
  useEffect(() => {
    if (!activeGoal && !pending) return;
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try { await readHistory(); } catch { if (alive) setNotice("Research status couldn’t reload. Check again; don’t start a replacement task."); }
      // Schedule after completion; overlapping automatic reads can otherwise
      // indefinitely invalidate an artifact on a slow connection.
      if (alive) timer = setTimeout(() => void refresh(), 5000);
    };
    void refresh();
    return () => { alive = false; clearTimeout(timer); };
    // The polling scope is the exact goal/command, not changing artifact contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, activeGoal, pending?.body.commandId]);
  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setNotice("");
    try { await fn(); } catch (error) { if (mounted.current) setNotice(error instanceof Error ? error.message : "Your request wasn’t confirmed. Check its status before trying again."); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const open = () => {
    dialog.current?.showModal();
    void run(async () => { const next = await responseJson<ResearchWorkspaceChoices>(await fetch(endpoint, { cache: "no-store" })); if (mounted.current) { setChoices(next); setReview(null); } });
  };
  const restoreFocus = useCallback(() => {
    focusRestoration.current = true;
    requestAnimationFrame(() => {
      if (dialog.current?.open) return;
      const target = opener.current?.isConnected ? opener.current : host.current?.querySelector<HTMLElement>("[data-research-focus]");
      // Escape may close while choices are loading and the opener is disabled.
      // Keep focus in this host now, then restore the opener once it is enabled.
      if (target instanceof HTMLButtonElement && target.disabled) { host.current?.focus(); return; }
      target?.focus(); if (target) focusRestoration.current = false;
    });
  }, []);
  useEffect(() => { if (!busy && focusRestoration.current && !dialog.current?.open) restoreFocus(); }, [busy, restoreFocus]);
  const close = () => { dialog.current?.close(); };
  const change = (patch: Partial<Draft>) => { setDraft(current => ({ ...current, ...patch })); setReview(null); setNotice(""); };
  const request = (): ResearchWorkspaceRequest => {
    if (!choices) throw new Error("Load the trip details first.");
    const selection = { party: choices.people.filter(p => draft.people.includes(p.id)).map(factRef),
      stays: draft.kind === "transport" ? choices.stays.filter(s => s.id === draft.stay).map(factRef) : [],
      flights: draft.kind === "transport" ? choices.flights.filter(f => [draft.arrival, draft.departure].includes(f.id)).map(factRef) : [], plans: [] };
    const base = { title: draft.title, queries: draft.queries.split("\n").map(q => q.trim()).filter(Boolean).map((text, i) => ({ id: `query-${i + 1}`, text, followUpFor: null })) };
    if (draft.kind === "winery") return { selection, request: { ...base, kind: "winery", visitDate: draft.date || null,
      nominated: draft.names.split("\n").map(n => n.trim()).filter(Boolean).map((name, i) => ({ id: `winery-${i + 1}`, name, priority: false, memberConnection: false })) } };
    const stayRef = selection.stays[0], arrivalRef = selection.flights.find(f => f.id === draft.arrival), departureRef = selection.flights.find(f => f.id === draft.departure);
    if (!stayRef || !arrivalRef || !departureRef) throw new Error("Choose a saved stay and both flight cohorts.");
    return { selection, request: { ...base, kind: "transport", stayRef, arrivalRef, departureRef, wineryDate: draft.date || null } };
  };
  const preview = () => void run(async () => {
    const next = await responseJson<ResearchWorkspaceReview>(await fetch(`${endpoint}?action=prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request()) }));
    if (mounted.current) setReview(next);
  });
  const sendExact = async (record: ResearchPending) => {
    const originScope = `${endpoint}:${record.body.commandId}`;
    // On any HTTP or network uncertainty the journal stays put. Recovery is a
    // read, and an explicit retry reuses the SAME body and command UUID.
    await responseJson(await fetch(`${endpoint}?action=start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record.body) }));
    const sequence = ++readSequence.current;
    const result = await responseJson<{ history: ResearchWorkspaceHistory | null }>(await fetch(`${endpoint}?commandId=${record.body.commandId}`, { cache: "no-store" }));
    if (!result.history || result.history.reviewCommandId !== record.body.commandId) throw new Error("The matching receipt isn’t available yet. Check this request; don’t start a replacement.");
    if (mounted.current && readScope.current === originScope) { if (researchReadIsCurrent(originScope, readScope.current, sequence, lastAppliedRead.current)) { lastAppliedRead.current = sequence; setHistory(result.history); setFollowGoal(result.history.goalId); } setNotice("Research request saved. No booking or trip changes approved."); close(); onStarted?.(result.history.goalId); }
  };
  const approve = () => void run(async () => {
    if (!review || pending || journalBlocked || review.availability !== "fixture_ready") return;
    const record: ResearchPending = { version: 1, body: { ...review.request, expectedSourceFingerprint: review.sourceFingerprint, commandId: crypto.randomUUID() } };
    // If persistence is blocked, refuse sending rather than lose the request ID.
    localStorage.setItem(journal, JSON.stringify(record)); readScope.current = `${endpoint}:${record.body.commandId}`; lastAppliedRead.current = ++readSequence.current; setPending(record); close(); await sendExact(record);
  });
  const check = () => void run(async () => { const result = await readHistory(); setNotice(result ? "Found the original request. Its status is shown below." : "No saved receipt found yet. You can retry this exact request, not start a replacement."); });
  const confirmed = history && (activeGoal ? history.goalId === activeGoal : !pending || history.reviewCommandId === pending.body.commandId);
  const unknown = !goalId && pending !== null && !confirmed;
  return <section className="research-workspace" ref={host} tabIndex={-1} aria-label={goalId ? "Research artifact" : "Bounded research"}>
    {!goalId && !pending && intro === "link" ? <p className="research-workspace-intro research-workspace-intro--link"><button type="button" className="text-action" ref={opener} disabled={disabled || busy || journalBlocked || !restored} onClick={open}>Research a decision…</button></p> : null}
    {!goalId && !pending && intro === "card" ? <div className="research-workspace-intro"><div><h3>Research a decision</h3><p>Choose the people and plans to use, then review the search before Commons starts.</p></div><button type="button" className="cm-action" ref={opener} disabled={disabled || busy || journalBlocked || !restored} onClick={open}>New research task</button></div> : null}
    {unknown ? <div className="research-workspace-recovery" tabIndex={-1} data-research-focus><h3>Check your research request</h3><p>{busy ? "Sending the reviewed request. Its original command is saved on this device." : "Sending wasn’t confirmed. The original request is saved on this device."}</p><button type="button" className="cm-action" disabled={busy} onClick={check}>Check request status</button><button type="button" className="cm-action" disabled={busy} onClick={() => void run(() => sendExact(pending!))}>Retry the same request</button></div> : null}
    {history && confirmed ? <article className="research-workspace-artifact" tabIndex={-1} data-research-focus><p className="research-workspace-meta">Commons · Research · {history.goalLifecycle.replaceAll("_", " ")}</p>
      {history.stale ? <p className="research-workspace-attention">Earlier research · trip facts, approval or task status changed, or current validation is unavailable. This is not a current recommendation.</p> : null}
      {history.comparison ? <ResearchDecisionComparisonView comparison={history.comparison} scope={history.scope} sources={history.sources} canEdit={false} stale={history.stale}
        onQuestion={question => onQuestion(question.question)} /> : <><h3>{history.scope.title}</h3><p>{history.goalLifecycle === "cancelled" || history.taskStatus === "cancelled" ? "Research was cancelled. Nothing new will run for this request." : !history.stale && history.goalLifecycle === "running" && ["pending", "processing"].includes(history.taskStatus ?? "") && history.executionStatus === "running" ? "Research is in progress. You can leave this page; the local test runner owns the job." : "Research is paused or out of date. Check the task before requesting another attempt."}</p></>}
      <details><summary>Reviewed searches and execution</summary><ul>{history.queries.map(q => <li key={q.id}>{q.text}</li>)}</ul><p>{history.calls} calls reserved · {history.stages} stages · Test data only. Nothing booked.</p></details>
      {history.transportAnswers ? <ResearchTransportAnswer key={`${slug}:${actorId}:${history.goalId}`} slug={slug} actorId={actorId} history={history} disabled={disabled}
        onApplied={() => { void run(async () => { await readHistory(); onStarted?.(history.goalId); }); }} /> : null}
      <button type="button" className="cm-action" disabled={busy} onClick={check}>Refresh research</button>
      {!goalId && confirmed ? <button type="button" className="cm-action" disabled={disabled || busy} onClick={() => { readScope.current = `${endpoint}:none`; lastAppliedRead.current = ++readSequence.current; localStorage.removeItem(journal); setPending(null); setFollowGoal(null); setHistory(null); setReview(null); open(); }}>Prepare another research task</button> : null}
    </article> : null}
    <p role="status" className="research-workspace-notice">{notice}</p>
    <dialog ref={dialog} className="research-workspace-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); close(); }} onClose={restoreFocus}>
      <header><div><p className="research-workspace-meta">Commons · Organizer review</p><h2 id={`${id}-title`}>Review your research task</h2></div><button type="button" className="cm-action" onClick={close}>Close research review</button></header>
      <div className="research-workspace-form" aria-busy={busy}>
        <p>Test workspace. Searches use invented sources, not live suppliers. No bookings, messages or itinerary changes.</p>
        {choices?.availability === "unavailable" ? <p className="research-workspace-attention">Planned · research unavailable. You can prepare a review; nothing will be queued.</p> : null}
        <label>Research type<select aria-label="Research type" value={draft.kind} disabled={busy || Boolean(pending)} onChange={e => change({ kind: e.target.value as Draft["kind"], title: e.target.value === "winery" ? "Compare winery options" : "Compare transport options" })}><option value="winery">Winery comparison</option><option value="transport">Transport comparison</option></select></label>
        <label>Task title<input value={draft.title} maxLength={160} disabled={busy || Boolean(pending)} onChange={e => change({ title: e.target.value })} /></label>
        <fieldset disabled={busy || Boolean(pending)}><legend>Who is this research for?</legend><p>Choose people reported as attending. This doesn’t change anyone’s attendance.</p>
          {choices?.people.map(p => <label className="research-workspace-choice" key={p.id}><input type="checkbox" disabled={!p.eligible} checked={draft.people.includes(p.id)} onChange={e => change({ people: e.target.checked ? [...draft.people, p.id] : draft.people.filter(x => x !== p.id) })} /><span>{p.name}<small>{p.attendance} · {p.membership}{p.attendanceDates ? ` · ${p.attendanceDates}` : ""}</small></span></label>)}
        </fieldset>
        {draft.kind === "winery" ? <label>Wineries to compare · one per line<textarea aria-label="Wineries to compare · one per line" rows={3} value={draft.names} disabled={busy || Boolean(pending)} onChange={e => change({ names: e.target.value })} /></label> : <>
          <label>Saved lodging anchor<select aria-label="Saved lodging anchor" value={draft.stay} disabled={busy || Boolean(pending)} onChange={e => change({ stay: e.target.value })}><option value="">Choose a saved stay</option>{choices?.stays.map(s => <option key={s.id} value={s.id}>{s.name} · {s.startsOn}–{s.endsOn}</option>)}</select></label>
          {(["arrival", "departure"] as const).map(kind => <label key={kind}>{kind === "arrival" ? "Arrival" : "Departure"} flight cohort<select aria-label={`${kind === "arrival" ? "Arrival" : "Departure"} flight cohort`} value={draft[kind]} disabled={busy || Boolean(pending)} onChange={e => change({ [kind]: e.target.value })}><option value="">Choose a saved flight cohort</option>{choices?.flights.filter(f => f.kind === kind).map(f => <option key={f.id} value={f.id}>{f.endpoints.join(", ") || "Typed route unknown"} · {f.date}</option>)}</select></label>)}
          <p>Only shared flight plans that are no longer being considered can anchor transport research. Save those decisions first if a cohort is missing.</p>
          <p>Driver willingness and luggage are still unresolved. A conversation answer won’t silently change this research request.</p>
        </>}
        <label>{draft.kind === "winery" ? "Visit day (optional)" : "Winery transport day"}<input type="date" value={draft.date} min={choices?.trip.startsOn ?? undefined} max={choices?.trip.endsOn ?? undefined} disabled={busy || Boolean(pending)} onChange={e => change({ date: e.target.value })} /></label>
        <label>Public searches · one per line<textarea aria-label="Public searches · one per line" rows={3} value={draft.queries} disabled={busy || Boolean(pending)} onChange={e => change({ queries: e.target.value })} /></label><p>Leave out names, booking codes, private costs, addresses and exact travel dates or times. Commons won’t silently rewrite these searches.</p>
        <button type="button" className="cm-action" disabled={busy || !choices || Boolean(pending)} onClick={preview}>Review this request</button>
        {review ? <section className="research-workspace-preview" aria-label="Prepared research request"><h3>{review.plan.title}</h3><p>{review.people.join(", ")} · {review.plan.partySize} travelers</p><p>{review.plan.startsOn}–{review.plan.endsOn} · {review.plan.requestedWeekdays.join(" / ")}</p>{review.plan.nominated.length ? <ul>{review.plan.nominated.map(n => <li key={n.id}>{n.name}{n.priority ? " · Preferred" : ""}{n.memberConnection ? " · Member connection reported" : ""}</li>)}</ul> : null}{review.plan.legs.length ? <ul>{review.plan.legs.map(l => <li key={l.id}>{l.label} · {l.origin ?? "Unknown"} → {l.destination ?? "Unknown"} · {l.date ?? "Day unknown"}</li>)}</ul> : null}<h4>Only these public searches</h4><ul>{review.plan.queries.map(q => <li key={q.id}>{q.text}</li>)}</ul><p>Approval starts one new, bounded research task with a linked conversation. It does not book, send messages or change the itinerary.</p><button type="button" className="cm-action cm-action--primary" disabled={disabled || busy || Boolean(pending) || journalBlocked || review.availability !== "fixture_ready"} onClick={approve}>Approve and start test research</button></section> : null}
        <p role="status">{notice}</p>
      </div>
    </dialog>
  </section>;
}
