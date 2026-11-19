"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CoordinatorTask, ThreadOutcome, ThreadRelation, TurnSteering } from "@commons/contracts";
import { StartSubthreadRequestSchema } from "@commons/contracts";
import { requestJson } from "@/lib/coordinator-client";
import { clarifyChoice, continuityEndpoint, isLive, lastChangeText, loadTasks, newlyFinished, runTaskOperation, StableCommands, taskStatusText, type TaskCapability } from "@/lib/coordinator-tasks-client";

/*
 * Pieces of the continuous coordinator (docs/COORDINATOR-CONTINUITY-REVIEW.md). They render only when steering is on. The Workspace stays the one owner of
 * navigation and sending; these components own task status, task controls and the subthread form, and report back through callbacks.
 */

const quoted = (title: string) => `“${title}”`;

/** The honest line shown when tasks cannot run here. It never says work continues after leaving. */
export function tasksUnavailableText(capability: TaskCapability) {
  return capability.reason === "runner" ? "Background tasks aren’t running here yet. You can still ask me in conversation."
    : "Background research isn’t connected here. You can still ask me in conversation.";
}

export function CoordinatorTaskPanel({ slug, threadId, threadKind, initialCapability, disabled, onFinished, onViewResult, onOutcomeLinked, onTasks, label = "Tasks" }: {
  label?: string;
  slug: string; threadId: string; threadKind: "main" | "sub" | "task" | "topic"; initialCapability: TaskCapability; disabled: boolean;
  /** Called with every fresh task list, so working material can mark a result as current or out of date. */
  onTasks?: (tasks: CoordinatorTask[]) => void;

  /** A task revision finished while this page was open (once per revision): refresh the thread's saved results. */
  onFinished: () => void; onViewResult: () => void; onOutcomeLinked: () => void;
}) {
  const [tasks, setTasks] = useState<CoordinatorTask[] | null>(null);
  const [capability, setCapability] = useState(initialCapability);
  const [loadError, setLoadError] = useState(false);
  const [polledAt, setPolledAt] = useState(0);
  // The panel folds to its heading so the conversation keeps the room. On a phone it starts folded; a task that needs the organizer opens it until they choose.
  // An explicit choice is remembered on this device.
  const collapseKey = `commons:${slug}:tasks-collapsed`;
  const [pref, setPref] = useState<"1" | "0" | null>(null), [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setNarrow(window.matchMedia("(max-width: 767px)").matches);
      try { const stored = window.localStorage.getItem(collapseKey); setPref(stored === "1" || stored === "0" ? stored : null); } catch { /* storage is optional */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [collapseKey]);
  const needsYou = (tasks ?? []).some(task => task.status === "needs_input");
  const collapsed = pref === "1" || (pref === null && narrow && !needsYou);
  function toggleCollapsed() { const next = collapsed ? "0" : "1"; setPref(next); try { window.localStorage.setItem(collapseKey, next); } catch { /* optional */ } }
  const [announcement, setAnnouncement] = useState("");
  const [notice, setNotice] = useState<{ taskId: string | null; message: string } | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [open, setOpen] = useState<{ kind: "detail" | "cancel" | "answer"; taskId: string } | null>(null);
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", query: "", brief: "" });
  const [refresh, setRefresh] = useState(0);
  // Rows are compact (title and state on one line); a row opens to show its details and controls. A task that needs the organizer is always open.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const commands = useRef(new StableCommands());
  const previous = useRef<CoordinatorTask[] | null>(null);
  const seen = useRef(new Set<string>());
  const finished = useRef(onFinished), report = useRef(onTasks);
  useEffect(() => { finished.current = onFinished; report.current = onTasks; }, [onFinished, onTasks]);
  const headingId = useId(), noteId = useId(), newTaskButton = useRef<HTMLButtonElement>(null), focusTarget = useRef<HTMLInputElement & HTMLButtonElement>(null);
  // A control that opens a form or a confirmation moves focus into it, and closing it returns focus to the control that opened it.
  useEffect(() => { if (open) focusTarget.current?.focus(); }, [open]);

  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    previous.current = null; seen.current = new Set();
    async function poll() {
      try {
        const next = await loadTasks(slug, threadId, controller.signal);
        if (stopped) return;
        const done = newlyFinished(previous.current, next.tasks, seen.current);
        previous.current = next.tasks;
        // Tasks already finished when the page opened are shown, not announced; each later revision is announced once.
        for (const task of next.tasks) if (task.status === "succeeded" && !task.resultOutdated) seen.current.add(`${task.taskId}:${task.revision}`);
        setTasks(next.tasks); setCapability(next.capability); setLoadError(false); setPolledAt(Date.now()); report.current?.(next.tasks);
        if (done.length) { setAnnouncement(`${done.map(task => quoted(task.title)).join(" and ")} ${done.length === 1 ? "has" : "have"} a result. Sources are in working material.`); finished.current(); }
      } catch { if (!stopped) setLoadError(true); }
      finally {
        // Frequent while something is live, rare otherwise; paused while the tab is hidden.
        if (!stopped) timer = setTimeout(poll, document.hidden ? 15_000 : previous.current?.some(isLive) ? 3_000 : 12_000);
      }
    }
    void poll();
    const onVisible = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [slug, threadId, refresh]);

  const live = (tasks ?? []).filter(isLive);
  const settle = useCallback((task: CoordinatorTask) => setTasks(value => { const next = (value ?? []).map(item => item.taskId === task.taskId ? task : item); report.current?.(next); return next; }), []);

  async function amend(task: CoordinatorTask, text: string) {
    const body = text.trim();
    if (!body || busyTask) return;
    setBusyTask(task.taskId); setNotice(null);
    const key = `amend:${task.taskId}:${task.revision}:${body}`;
    const result = await runTaskOperation(slug, { op: "amend", commandId: commands.current.idFor(key), threadId, taskId: task.taskId, expectedRevision: task.revision, note: body });
    setBusyTask(null);
    if (result.ok) {
      commands.current.settle(key); settle(result.task); setOpen(null); setNote("");
      setNotice({ taskId: task.taskId, message: result.task.status === "needs_input" ? `Revision ${result.task.revision} accepted. Still waiting for your answer.` : `Revision ${result.task.revision} accepted. ${result.task.status === "queued" ? "It’s queued." : "Working on it."}${result.task.resultOutdated ? " The earlier result is out of date." : ""}` });
    } else {
      // A stale revision is not retried with the same words: the task moved, so reload it and let the organizer decide.
      if (result.refusal.code === "stale_revision") { commands.current.settle(key); setRefresh(value => value + 1); }
      setNotice({ taskId: task.taskId, message: result.refusal.message });
    }
  }
  async function cancel(task: CoordinatorTask) {
    if (busyTask) return;
    setBusyTask(task.taskId); setNotice(null);
    const key = `cancel:${task.taskId}`;
    const result = await runTaskOperation(slug, { op: "cancel", commandId: commands.current.idFor(key), threadId, taskId: task.taskId });
    setBusyTask(null);
    if (result.ok) {
      commands.current.settle(key); settle(result.task); setOpen(null);
      setNotice({ taskId: task.taskId, message: result.cancelled ? "Cancelled. Anything it was still writing is discarded." : result.task.status === "succeeded" ? "It had already finished, so nothing was cancelled. Its result is saved." : "It had already stopped. Nothing changed." });
    } else setNotice({ taskId: task.taskId, message: result.refusal.message });
  }
  async function start() {
    const title = form.title.trim(), query = form.query.trim();
    if (!title || !query || busyTask) return;
    setBusyTask("new"); setNotice(null);
    const key = `start:${title}|${query}|${form.brief.trim()}`;
    const result = await runTaskOperation(slug, { op: "start", commandId: commands.current.idFor(key), threadId, title, query, brief: form.brief.trim() });
    setBusyTask(null);
    if (result.ok) { commands.current.settle(key); setCreating(false); setForm({ title: "", query: "", brief: "" }); setRefresh(value => value + 1); setNotice({ taskId: result.task.taskId, message: `Started ${quoted(result.task.title)}. You can keep talking here.` }); requestAnimationFrame(() => newTaskButton.current?.focus()); }
    else setNotice({ taskId: null, message: result.refusal.message });
  }
  async function linkOutcome(task: CoordinatorTask) {
    setBusyTask(task.taskId); setNotice(null);
    try {
      await requestJson(continuityEndpoint(slug), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "link_outcome", threadId, taskId: task.taskId, revision: task.revision }) });
      setNotice({ taskId: task.taskId, message: "Added to the Trip conversation once. Its sources stay here." }); onOutcomeLinked();
    } catch (cause) { setNotice({ taskId: task.taskId, message: cause instanceof Error ? cause.message : "That wasn’t added. Nothing changed." }); }
    finally { setBusyTask(null); }
  }

  // What needs the organizer first, then work in progress, then what has finished.
  const rank = (task: CoordinatorTask) => ({ needs_input: 0, running: 1, queued: 2, succeeded: 3, failed: 4, cancelled: 5 })[task.status];
  const ownRows = [...(tasks ?? [])].sort((a, b) => rank(a) - rank(b));
  return <section className="workspace-tasks" aria-labelledby={headingId}>
    <header className="workspace-tasks-heading">
      <h2 id={headingId}><button type="button" className="workspace-tasks-toggle" aria-expanded={!collapsed} aria-controls={`${headingId}-body`} onClick={toggleCollapsed}>
        {label}{tasks ? ` · ${live.length} in progress` : ""}{tasks && tasks.some(task => task.status === "needs_input") ? " · needs you" : ""}</button></h2>
      <button ref={newTaskButton} type="button" className="cm-action" aria-expanded={creating} disabled={disabled || !capability.available} onClick={() => { if (collapsed) { setPref("0"); } setCreating(value => !value); }}>{creating ? "Close" : label === "Research tasks" ? "Research" : "New task"}</button>
    </header>
    <div className="workspace-tasks-live" role="status" aria-live="polite">{announcement}</div>
    <div id={`${headingId}-body`} hidden={collapsed}>
    {tasks === null && !loadError ? <p className="cm-note" role="status">Checking tasks…</p> : null}
    {!capability.available ? <p className="cm-note">{tasksUnavailableText(capability)}</p> : null}
    {loadError ? <p className="cm-note cm-note--attention" role="status">Task status couldn’t refresh. Reconnecting shortly. Saved work is safe.</p> : null}
    {creating ? <form className="workspace-task-form" onSubmit={event => { event.preventDefault(); void start(); }}>
      <label>Task name<input value={form.title} maxLength={120} onChange={event => setForm(value => ({ ...value, title: event.target.value }))} placeholder="Airport transfers" /></label>
      <label>What to look up<input value={form.query} maxLength={500} onChange={event => setForm(value => ({ ...value, query: event.target.value }))} placeholder="Airport transfer options near Sonoma" /></label>
      <p className="review-caption">Only this search goes to the search provider. Leave out names and private details.</p>
      <label>Notes for your organizers<textarea rows={2} maxLength={1000} value={form.brief} onChange={event => setForm(value => ({ ...value, brief: event.target.value }))} placeholder="Seven travelers; two arrive later." /></label>
      <p className="review-caption">Research only. Nothing is booked, paid, sent or changed in your trip.</p>
      <div className="workspace-actions"><button type="submit" className="cm-action cm-action--primary" disabled={busyTask === "new" || !form.title.trim() || !form.query.trim()}>Start task</button></div>
    </form> : null}
    {tasks && !ownRows.length && capability.available && !creating ? <p className="cm-note">No tasks yet. Start one, or ask for research in the conversation.</p> : null}
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Long task lists must be keyboard-scrollable on short screens. */}
    {ownRows.length ? <ul className="workspace-task-list" tabIndex={0} aria-label="Tasks in this conversation">
      {ownRows.map(task => { const isOpen = opened.has(task.taskId) || task.status === "needs_input" || notice?.taskId === task.taskId || open?.taskId === task.taskId; return <li key={task.taskId} className="workspace-task" data-status={task.status}>
        <button type="button" className="workspace-task-head" aria-expanded={isOpen} aria-controls={`${noteId}-row-${task.taskId}`} disabled={task.status === "needs_input"}
          onClick={() => setOpened(value => { const next = new Set(value); if (next.has(task.taskId)) next.delete(task.taskId); else next.add(task.taskId); return next; })}>
          <strong>{task.title}</strong><span className="workspace-task-state">{taskStatusText(task)}</span></button>
        {isOpen ? <div id={`${noteId}-row-${task.taskId}`}>
        <p className="review-caption">Revision {task.revision}{task.requestedByName && !task.ownedByMe ? ` · Started by ${task.requestedByName}` : ""}{lastChangeText(task) ? ` · ${lastChangeText(task)}` : ""}</p>
        {task.status === "needs_input" && task.needsInput ? <p className="workspace-task-need">{task.needsInput}</p> : null}
        {task.status === "succeeded" ? <p className="review-caption">{task.resultOutdated ? "The saved result answers an earlier revision and is out of date." : "Sources and limits are in working material."}</p> : null}
        {task.status === "failed" ? <p className="review-caption">Nothing from this task was saved. You can start a new one.</p> : null}
        {task.status === "queued" && !task.waitingForSlot && polledAt - Date.parse(task.updatedAt) > 3 * 60_000 ? <p className="review-caption">Still queued after {Math.floor((polledAt - Date.parse(task.updatedAt)) / 60_000)} minutes. If it doesn’t start soon, the task runner may not be running. Nothing is lost; you can cancel it.</p> : null}
        {notice?.taskId === task.taskId ? <p className="review-caption" role="status">{notice.message}</p> : null}
        <div className="workspace-actions">
          {task.hasResult ? <button type="button" className="cm-action" onClick={onViewResult}>View sources</button> : null}
          {task.ownedByMe && task.status !== "cancelled" ? <>
            {task.status === "needs_input"
              ? <button type="button" className="cm-action cm-action--primary" disabled={disabled || busyTask !== null} aria-expanded={open?.taskId === task.taskId && open.kind === "answer"} onClick={() => { setOpen(open?.taskId === task.taskId && open.kind === "answer" ? null : { kind: "answer", taskId: task.taskId }); setNote(""); }}>Answer</button>
              : <button type="button" className="cm-action" disabled={disabled || busyTask !== null} aria-expanded={open?.taskId === task.taskId && open.kind === "detail"} onClick={() => { setOpen(open?.taskId === task.taskId && open.kind === "detail" ? null : { kind: "detail", taskId: task.taskId }); setNote(""); }}>Update</button>}
            {isLive(task) ? <button type="button" className="cm-action" disabled={disabled || busyTask !== null} onClick={() => setOpen({ kind: "cancel", taskId: task.taskId })}>Cancel task</button> : null}
          </> : null}
          {threadKind === "sub" && task.ownedByMe && task.status === "succeeded" && !task.resultOutdated ? <button type="button" className="cm-action" disabled={disabled || busyTask !== null} onClick={() => void linkOutcome(task)}>Add result to Trip conversation</button> : null}
        </div>
        {!task.ownedByMe && isLive(task) ? <p className="review-caption">Only {task.requestedByName} can change or cancel this task.</p> : null}
        {open?.taskId === task.taskId && open.kind !== "cancel" ? <form className="workspace-task-form" onSubmit={event => { event.preventDefault(); void amend(task, note); }}>
          <label htmlFor={`${noteId}-${task.taskId}`}>{open.kind === "answer" ? task.needsInput : `Change for ${task.title}`}</label>
          <input id={`${noteId}-${task.taskId}`} ref={focusTarget} value={note} maxLength={500} onChange={event => setNote(event.target.value)} />
          <p className="review-caption">{open.kind === "answer" ? "Your answer is added to the task and it runs again." : "This changes the task, not your saved trip. Work in progress is replaced; an earlier result is kept and marked out of date."}</p>
          <div className="workspace-actions"><button type="submit" className="cm-action cm-action--primary" disabled={!note.trim() || busyTask !== null}>Send</button><button type="button" className="cm-action" onClick={() => setOpen(null)}>Close</button></div>
        </form> : null}
        {open?.taskId === task.taskId && open.kind === "cancel" ? <div className="workspace-task-confirm" role="group" aria-label={`Cancel ${task.title}?`}>
          <p>Cancel {quoted(task.title)}? Work in progress is discarded and won’t be saved.</p>
          <div className="workspace-actions"><button type="button" className="cm-action cm-action--primary" ref={focusTarget} disabled={busyTask !== null} onClick={() => void cancel(task)}>Cancel task</button><button type="button" className="cm-action" onClick={() => setOpen(null)}>Keep it</button></div>
        </div> : null}
        </div> : null}
      </li>; })}
    </ul> : null}
    {notice && notice.taskId === null ? <p className="review-caption" role="status">{notice.message}</p> : null}
    </div>
  </section>;
}

/** The receipt a steering turn leaves in the conversation: a question with selectable tasks, or an offer to start a task. The text itself is the turn's reply. */
export function SteeringChoices({ steering, disabled, onChoose, onStartSuggested }: {
  steering: TurnSteering | undefined; disabled: boolean;
  onChoose: (choice: NonNullable<ReturnType<typeof clarifyChoice>>) => void; onStartSuggested: (title: string, query: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (!steering || dismissed) return null;
  if (steering.kind === "clarify") {
    return <div className="workspace-clarify" role="group" aria-label="Which task do you mean?">
      <div className="workspace-actions">{steering.candidates.map(candidate => <button key={candidate.taskId} type="button" className="cm-action workspace-clarify-option" disabled={disabled}
        onClick={() => { const choice = clarifyChoice(steering, candidate.taskId); if (choice) onChoose(choice); }}>{candidate.title}<small>Revision {candidate.revision}</small></button>)}</div>
      <p className="review-caption">Choose one to apply your message. Nothing has changed yet.</p>
    </div>;
  }
  if (steering.kind === "suggest_task") {
    return <div className="workspace-actions"><button type="button" className="cm-action cm-action--primary" disabled={disabled} onClick={() => { onStartSuggested(steering.title, steering.query); setDismissed(true); }}>Start task</button>
      <button type="button" className="cm-action" onClick={() => setDismissed(true)}>Not now</button></div>;
  }
  return null;
}

/** Where this conversation sits: the main conversation, or a subthread with its attributed brief and a way back. */
export function ThreadRelationNote({ relation, mainThreadId, parentTitle, creatorName, onOpen }: { relation: ThreadRelation | null; mainThreadId: string | null; parentTitle: string | null; creatorName: string | null; onOpen: (threadId: string) => void }) {
  if (relation?.kind === "main") return null;
  if (relation?.kind === "task") return mainThreadId ? <p className="review-caption workspace-relation"><button type="button" className="workspace-topic" onClick={() => onOpen(mainThreadId)}>Back to Coordinator</button></p> : null;
  if (relation?.kind !== "sub") return mainThreadId ? <p className="review-caption workspace-relation"><button type="button" className="workspace-topic" onClick={() => onOpen(mainThreadId)}>Back to the Trip conversation</button></p> : null;
  return <div className="workspace-relation">
    <p className="review-caption">Subthread{parentTitle ? ` of ${parentTitle}` : ""} · Organizers only</p>
    {mainThreadId ? <p className="review-caption"><button type="button" className="workspace-topic" onClick={() => onOpen(relation.parentThreadId ?? mainThreadId)}>Back to {parentTitle ?? "the Trip conversation"}</button></p> : null}
    {relation.brief ? <details><summary>Starting brief{creatorName ? ` · by ${creatorName}` : ""}</summary><p>{relation.brief}</p></details> : null}
  </div>;
}

export function LinkedOutcomes({ outcomes, onOpen }: { outcomes: ThreadOutcome[]; onOpen: (threadId: string) => void }) {
  if (!outcomes.length) return null;
  return <section className="workspace-outcomes" aria-label="Results from subthreads">
    <h2>From subthreads</h2>
    <ul>{outcomes.map(outcome => <li key={outcome.id}><span>{outcome.summary}</span><span className="review-caption"> · From {quoted(outcome.sourceTitle)} · Revision {outcome.taskRevision}</span>{" "}<button type="button" className="workspace-topic" onClick={() => onOpen(outcome.sourceThreadId)}>Open subthread</button></li>)}</ul>
  </section>;
}

/** Start a subthread the organizer chose: an editable title and brief, optional links to existing tasks. Nothing moves; the tasks keep their place. */
export function SubthreadStarter({ slug, parentThreadId, onCreated, onClose, disabled }: { slug: string; parentThreadId: string; onCreated: (threadId: string) => void; onClose: () => void; disabled: boolean; }) {
  const [tasks, setTasks] = useState<CoordinatorTask[]>([]);
  const [title, setTitle] = useState(""), [brief, setBrief] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    loadTasks(slug, parentThreadId, controller.signal).then(next => {
      const related = next.tasks.filter(task => task.status !== "cancelled");
      setTasks(related);
      setBrief(value => value || (related.length ? `Continuing from the Trip conversation. Related tasks: ${related.slice(0, 3).map(task => task.title).join("; ")}.` : ""));
    }, () => undefined);
    return () => controller.abort();
  }, [slug, parentThreadId]);
  const [linked, setLinked] = useState<string[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const commandId = useRef(crypto.randomUUID()), threadId = useRef(crypto.randomUUID());
  const titleId = useId(), titleRef = useRef<HTMLInputElement>(null), formRef = useRef<HTMLFormElement>(null), close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    titleRef.current?.focus();
    // Escape closes the form from anywhere inside it.
    const form = formRef.current, onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close.current(); } };
    form?.addEventListener("keydown", onKey);
    return () => form?.removeEventListener("keydown", onKey);
  }, []);
  async function submit() {
    if (busy) return;
    const request = StartSubthreadRequestSchema.safeParse({ commandId: commandId.current, parentThreadId, threadId: threadId.current, title: title.trim() || brief.trim().slice(0, 60) || "New subthread", brief: brief.trim(), briefTaskIds: linked });
    if (!request.success) { setError("Add a title or a short brief first."); return; }
    setBusy(true); setError("");
    try { const created = await requestJson<{ id: string }>(continuityEndpoint(slug), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.data) }); onCreated(created.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The subthread wasn’t started. Nothing changed."); }
    finally { setBusy(false); }
  }
  return <form ref={formRef} className="workspace-subthread-form" aria-labelledby={`${titleId}-h`} onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h2 id={`${titleId}-h`}>Start a subthread</h2>
    <p className="review-caption">A separate place for one body of work. Nothing moves, and tasks already running stay where they started. Organizers only.</p>
    <label htmlFor={titleId}>Title (optional)</label>
    <input id={titleId} ref={titleRef} value={title} maxLength={120} onChange={event => setTitle(event.target.value)} placeholder="Wine tasting day" />
    <label htmlFor={`${titleId}-b`}>Starting brief</label>
    <textarea id={`${titleId}-b`} rows={3} maxLength={1000} value={brief} onChange={event => setBrief(event.target.value)} />
    {tasks.length ? <fieldset><legend>Link tasks the brief refers to</legend>{tasks.slice(0, 6).map(task => <label key={task.taskId} className="workspace-subthread-link"><input type="checkbox" checked={linked.includes(task.taskId)} onChange={event => setLinked(value => event.target.checked ? [...value, task.taskId] : value.filter(id => id !== task.taskId))} />{task.title} · Revision {task.revision}</label>)}</fieldset> : null}
    {error ? <p role="alert" className="review-caption">{error}</p> : null}
    <div className="workspace-actions"><button type="submit" className="cm-action cm-action--primary" disabled={busy || disabled}>Start subthread</button><button type="button" className="cm-action" onClick={onClose}>Cancel</button></div>
  </form>;
}
