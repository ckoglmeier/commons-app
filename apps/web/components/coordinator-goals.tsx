"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CoordinatorGoalSchema, GoalReportSchema, type CoordinatorGoal, type CoordinatorThread, type GoalOperationRequest, type GoalReport } from "@commons/contracts";
import { itemDetailPath } from "@/lib/commons-route";
import { requestJson } from "@/lib/coordinator-client";
import { goalLabel } from "@/lib/coordinator-goal-presentation";
import { GoalParticipantQuestions } from "./participant-question-ask";
type Suggestion={ideaId:string;ideaFingerprint:string;ideaVersion:string;ideaTitle:string;title:string;goal:string;query:string;existingThreadId:string|null};
export type GoalWorkspaceState = { goals: CoordinatorGoal[]; reports: GoalReport[]; suggestions?:Suggestion[] };
const terminal = (g: CoordinatorGoal) => ["completed", "cancelled", "failed"].includes(g.lifecycle);

export function useGoalWorkspace(slug: string, actorId: string | undefined, enabled: boolean, initial: GoalWorkspaceState) {
  const [state, setState] = useState(initial), [error, setError] = useState(""), [pending, setPending] = useState(false);
  const endpoint = `/api/v1/commons/${encodeURIComponent(slug)}/goals`;
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const body = await requestJson<GoalWorkspaceState>(endpoint, { cache: "no-store" });
    setState({ goals: body.goals.map(goal => CoordinatorGoalSchema.parse(goal)), reports: body.reports.map(report => GoalReportSchema.parse(report)), suggestions:body.suggestions ?? [] });
    setError("");
  }, [enabled, endpoint]);
  useEffect(() => {
    if (!enabled) return;
    const update = () => { if (document.visibilityState === "visible") void refresh().catch(() => setError("Tasks couldn’t refresh. Your conversation is still here.")); };
    const timer = window.setInterval(update, 15_000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [enabled, refresh]);
  const operate = async (input: Omit<GoalOperationRequest, "commandId"> | Record<string, unknown>) => {
    setPending(true); setError("");
    const storageKey = `commons:${slug}:${actorId}:goal-pending`, fingerprint = JSON.stringify(input);
    let commandId = crypto.randomUUID();
    try {
      try { const previous = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as { fingerprint: string; commandId: string } | null;
      if (previous?.fingerprint === fingerprint) commandId = previous.commandId;
      window.localStorage.setItem(storageKey, JSON.stringify({ fingerprint, commandId })); } catch { /* Request still has an idempotency key when browser storage is unavailable. */ }
      const body = await requestJson<{ goal: CoordinatorGoal }>(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, commandId }) });
      const goal = CoordinatorGoalSchema.parse(body.goal);
      try { window.localStorage.removeItem(storageKey); } catch { /* The server receipt is authoritative. */ }
      setState(value => ({ ...value, goals: [goal, ...value.goals.filter(item => item.goalId !== goal.goalId)] }));
      void refresh().catch(() => setError("Task saved. Reports couldn’t refresh; refresh to see the latest.")); return goal;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Task wasn’t saved. Your draft is still here."); return null; }
    finally { setPending(false); }
  };
  return { ...state, slug, error, pending, refresh, operate };
}
export type GoalController = ReturnType<typeof useGoalWorkspace>;

export function GoalTaskRail({ controller, slug, actorId, mainThreadId, selectedThreadId, disabled, ideas, onOpen, showCoordinator = true, heading = "Tasks" }: {
  /** The persistent Tasks panel names this section "Coordinator tasks" beside the person-owned To-dos. */
  heading?: string;
  showCoordinator?: boolean; controller: GoalController; slug: string; actorId?: string; mainThreadId: string; selectedThreadId: string | null; disabled: boolean;
  ideas: Array<{ id: string; title: string }>; onOpen: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false), [draft, setDraft] = useState({ kind: "research", title: "", goal: "", completionCriterion: "", query: "", ideaIds: [] as string[], ideaVersions: [] as Array<{id:string;version:string}> });
  const opener = useRef<HTMLButtonElement>(null), first = useRef<HTMLInputElement>(null);
  const key = `commons:${slug}:${actorId}:goal-brief`;
  useEffect(() => { const timer=window.setTimeout(()=>{ try { const saved = window.localStorage.getItem(key); if (saved) { const value=JSON.parse(saved); if (["research","poll","plan_action"].includes(value.kind) && [value.title,value.goal,value.query,value.completionCriterion].every(item=>typeof item === "string") && Array.isArray(value.ideaIds)) setDraft({...value,ideaVersions:Array.isArray(value.ideaVersions)?value.ideaVersions:[]}); } } catch { /* An unavailable draft store does not grant authority or submit. */ } },0);return()=>window.clearTimeout(timer); }, [key]);
  useEffect(() => { if (creating) first.current?.focus(); }, [creating]);
  const change = (value: typeof draft) => { setDraft(value); try {window.localStorage.setItem(key, JSON.stringify(value));}catch{/* The editable brief remains in this form. */} };
  const close = () => { setCreating(false); requestAnimationFrame(() => opener.current?.focus()); };
  const start = async () => {
    const goal = await controller.operate({ op: "start", ...draft });
    if (!goal) return;
    try{window.localStorage.removeItem(key);}catch{/* The confirmed task exists independently of browser storage. */} setDraft({ kind: "research", title: "", goal: "", completionCriterion: "", query: "", ideaIds: [], ideaVersions: [] }); close(); onOpen(goal.threadId);
  };
  const suggestions = controller.suggestions?.filter(suggestion => ideas.some(idea => idea.id === suggestion.ideaId)) ?? [];
  const active = controller.goals.filter(goal => !terminal(goal)).sort((a, b) => Number(b.lifecycle.startsWith("waiting")) - Number(a.lifecycle.startsWith("waiting")));
  const row = (goal: CoordinatorGoal) => <button key={goal.goalId} type="button" className="workspace-thread" data-role="task" aria-pressed={selectedThreadId === goal.threadId} disabled={disabled} onClick={() => onOpen(goal.threadId)}><span className="workspace-thread-title">{goal.title}</span><span className="workspace-thread-meta">{goalLabel(goal)}{selectedThreadId === goal.threadId ? " · Selected" : ""}</span></button>;
  return <>
    {showCoordinator ? <button type="button" className="workspace-thread" data-role="main" aria-pressed={selectedThreadId === mainThreadId} disabled={disabled} onClick={() => onOpen(mainThreadId)}><span className="workspace-thread-title">Coordinator</span><span className="workspace-thread-meta">Main conversation{selectedThreadId === mainThreadId ? " · Selected" : ""}</span></button> : null}
    <div className="workspace-board-heading">{heading === "Tasks" ? <h2>{heading}</h2> : <h3>{heading}</h3>}<button ref={opener} type="button" className="cm-action" disabled={disabled} onClick={() => setCreating(true)}>New task</button></div>
    {controller.error ? <p className="cm-note" role="alert">{controller.error}</p> : null}
    {creating ? <form role="group" aria-label="Task controls" className="workspace-task-form" onSubmit={event => { event.preventDefault(); void start(); }} onKeyDownCapture={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <label>Task name<input ref={first} required maxLength={120} value={draft.title} onChange={event => change({ ...draft, title: event.target.value })} /></label>
      <label>What should this task finish?<textarea required maxLength={1000} value={draft.goal} onChange={event => change({ ...draft, goal: event.target.value })} /></label>
      <label>Work to do<select value={draft.kind} onChange={event => change({ ...draft, kind: event.target.value })}><option value="research">Research references</option><option value="poll">Collect poll responses</option><option value="plan_action">Carry out a reviewed plan update</option></select></label>
      {draft.kind === "research" ? <><label>Public search query<input aria-describedby="goal-query-note" required maxLength={500} value={draft.query} onChange={event => change({ ...draft, query: event.target.value })} /></label><p id="goal-query-note" className="review-caption">Only this query goes to the search provider. Leave out names and private details.</p></> : null}
      <label>Finish line · optional<input maxLength={400} value={draft.completionCriterion} onChange={event => change({ ...draft, completionCriterion: event.target.value })} /></label>
      <p className="review-caption">Organizers can read this task. Publishing a poll and changing saved trip details keep their existing approvals. Booking and message delivery are unavailable.</p>
      <div className="workspace-actions"><button className="cm-action cm-action--primary" disabled={controller.pending}>Start task</button><button type="button" className="cm-action" disabled={controller.pending} onClick={close}>Cancel</button></div>
    </form> : null}
    <div className="workspace-thread-list">{active.map(row)}</div>
    {controller.goals.some(terminal) ? <details className="workspace-archive"><summary>Completed and earlier work</summary><div className="workspace-thread-list">{controller.goals.filter(terminal).map(row)}</div></details> : null}
    {suggestions.length ? <details className="workspace-board-ideas"><summary>Activities from Plan</summary><div className="workspace-thread-list">{suggestions.map(idea=><div key={idea.ideaId}><button type="button" className="workspace-thread" disabled={disabled} onClick={()=>{if(idea.existingThreadId){onOpen(idea.existingThreadId);return;}change({kind:"research",title:idea.title,goal:idea.goal,query:idea.query,completionCriterion:"Return sources, useful differences and unknowns.",ideaIds:[idea.ideaId],ideaVersions:[{id:idea.ideaId,version:idea.ideaVersion}]});setCreating(true);}}><span className="workspace-thread-title">{idea.ideaTitle}</span><span className="workspace-thread-meta">{idea.existingThreadId?"Open existing task":"Prepare a task brief"}</span></button><button type="button" className="cm-action" disabled={disabled} onClick={()=>{void requestJson(`/api/v1/commons/${slug}/goals`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({ideaId:idea.ideaId,expectedFingerprint:idea.ideaFingerprint})}).then(()=>controller.refresh());}}>Dismiss suggestion</button></div>)}</div></details> : null}
  </>;
}

export function GoalTaskDetails({ goal, controller, polls, turns, ideas = [], showWorkLink = true, conversationAvailable = true }: { goal: CoordinatorGoal; controller: GoalController; polls: Array<{ id: string; title: string }>; turns: CoordinatorThread["turns"]; ideas?:Array<{id:string;title:string}>; showWorkLink?: boolean; /** False on a beta trip: no link back to a conversation. */ conversationAvailable?: boolean }) {
  const [edit, setEdit] = useState<"amend" | "cancel" | "answer" | "reopen" | "edit_goal" | null>(null), [note, setNote] = useState(""), [selectedPoll, setSelectedPoll] = useState(""), [count, setCount] = useState(""), [rule, setRule] = useState("manual"), [deadline, setDeadline] = useState("");
  const [objective, setObjective] = useState(goal.goal), [criterion, setCriterion] = useState(goal.completionCriterion);
  const cancelFirst=useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLTextAreaElement>(null), opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (edit === "cancel") cancelFirst.current?.focus(); else if (edit) first.current?.focus(); }, [edit]);
  const close = () => { setEdit(null); requestAnimationFrame(() => opener.current?.focus()); };
  const noteKey=`commons:goal:${goal.goalId}:note`;
  useEffect(()=>{const timer=window.setTimeout(()=>{try{setNote(window.localStorage.getItem(noteKey)??"");}catch{/* State remains editable. */}},0);return()=>window.clearTimeout(timer);},[noteKey]);
  const changeNote=(value:string)=>{setNote(value);try{window.localStorage.setItem(noteKey,value);}catch{/* State remains editable. */}};
  const run = async (input: Record<string, unknown>) => { if (await controller.operate({ goalId: goal.goalId, expectedRevision: goal.revision, ...input })) { close(); changeNote(""); } };
  const activeStep = goal.steps.find(step => step.status !== "done");
  const review = turns.find(turn => turn.threadId === goal.threadId && turn.workspace?.tripProposal?.state === "pending");
  return <section className="workspace-task-detail" aria-label="Task scope and result">
    <p><strong>{goalLabel(goal)}</strong> · Started by {goal.requestedByName}</p><p>{goal.goal}</p>{goal.ideaIds.length ? <ul>{ideas.filter(idea=>goal.ideaIds.includes(idea.id)).map(idea=><li key={idea.id}><a className="cm-action" href={itemDetailPath(controller.slug, "plan", idea.id)}>{idea.title} · Plan reference</a></li>)}</ul> : null}<p className="review-caption">Finish line: {goal.completionCriterion}</p>
    {goal.resultStale ? <p className="cm-note">Saved context changed after this work began. Treat the result as earlier evidence; reopen explicitly if you need a current review.</p> : null}
    {goal.sourceThreadId && conversationAvailable ? <a className="cm-action" href={`/c/${controller.slug}/coordinator?thread=${goal.sourceThreadId}`}>Open original conversation</a> : null}
    {goal.kind === "planning" && showWorkLink ? <a className="cm-action" href={`/c/${controller.slug}/goals/${goal.goalId}`}>Open goal work</a> : null}
    {goal.waitDetail ? <p className="cm-note">{goal.waitDetail}</p> : null}
    {goal.outcome ? <details open={goal.lifecycle === "completed"}><summary>{goal.outcome.headline}{goal.outcomeRevision !== goal.revision ? " · Earlier result" : ""}</summary><p>{goal.outcome.detail}</p>{goal.outcome.retrievedAt ? <p className="review-caption">Retrieved <time dateTime={goal.outcome.retrievedAt}>{new Date(goal.outcome.retrievedAt).toLocaleString()}</time>. Prices and availability are unverified.</p> : null}{goal.outcome.sources.map((source, i) => <p key={i}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}</p>)}{goal.outcome.unknowns.map((text, i) => <p className="review-caption" key={i}>{text}</p>)}</details> : null}
    <GoalParticipantQuestions slug={controller.slug} goal={goal} />
    {goal.ownedByMe && goal.errorCode !== "workflow_archived" ? <>
      <div className="workspace-actions">{!terminal(goal) ? <button type="button" className="cm-action cm-action--link" disabled={controller.pending} onClick={event => { opener.current = event.currentTarget; setObjective(goal.goal); setCriterion(goal.completionCriterion); setEdit("edit_goal"); }}>Edit goal</button> : null}
      {(terminal(goal) ? ["reopen"] : [goal.lifecycle === "waiting_for_input" ? "answer" : "amend"]).map(op => <button key={op} type="button" className="cm-action cm-action--link" disabled={controller.pending} onClick={event => { opener.current = event.currentTarget; setEdit(op as typeof edit); }}>{op === "reopen" ? "Reopen goal" : op === "answer" ? "Answer" : "Add context"}</button>)}
      {!terminal(goal) ? <details className="recipe-secondary-actions"><summary>More goal actions</summary><button type="button" className="cm-action cm-action--link" disabled={controller.pending} onClick={event => { opener.current = event.currentTarget; setEdit("cancel"); }}>Cancel goal</button></details> : null}</div>
      {edit ? <form role="group" aria-label="Task controls" className="workspace-task-form" onKeyDownCapture={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }} onSubmit={event => { event.preventDefault(); void run({ op: edit, ...(edit === "edit_goal" ? { goal: objective, completionCriterion: criterion } : edit === "answer" ? { answer: note } : edit !== "cancel" ? { note } : {}) }); }}>
        {edit === "edit_goal" ? <><label>Goal<textarea ref={first} required maxLength={1000} value={objective} onChange={event => setObjective(event.target.value)} /></label><label>What does done look like?<textarea required maxLength={400} value={criterion} onChange={event => setCriterion(event.target.value)} /></label><p className="review-caption">Saving pauses current work for review. Earlier evidence and approvals stay in history, not as completion of the changed goal.</p></> : edit === "cancel" ? <p>Cancel “{goal.title}”? Work in progress cannot become a current result.</p> : <label>{edit === "answer" ? "Your answer" : "What should change?"}<textarea ref={first} required={edit !== "reopen"} maxLength={500} value={note} onChange={event => changeNote(event.target.value)} /></label>}
        <div className="workspace-actions"><button ref={edit === "cancel" ? cancelFirst : undefined} className={`cm-action ${edit === "cancel" ? "cm-action--destructive" : "cm-action--primary"}`} disabled={controller.pending}>{edit === "cancel" ? "Cancel goal" : edit === "reopen" ? "Reopen goal" : edit === "edit_goal" ? "Save goal" : "Save update"}</button><button type="button" className="cm-action" disabled={controller.pending} onClick={close}>Keep current</button></div>
      </form> : null}
      {activeStep?.kind === "poll" && activeStep.status === "waiting" && !activeStep.refId ? <form role="group" aria-label="Task controls" className="workspace-task-form" onSubmit={event => { event.preventDefault(); void run({ op: "link_poll", pollId: selectedPoll, rule: rule === "count" ? { mode: "count", count: Number(count) } : { mode: rule, ...(rule === "deadline" ? {at:new Date(deadline).toISOString()} : {}) } }); }}><label>Published poll<select required value={selectedPoll} onChange={event => setSelectedPoll(event.target.value)}><option value="">Choose a poll</option>{polls.map(poll => <option key={poll.id} value={poll.id}>{poll.title}</option>)}</select></label><label>Finish collection<select value={rule} onChange={event => setRule(event.target.value)}><option value="manual">When I finish it</option><option value="count">After a response count</option><option value="deadline">At a deadline</option><option value="all_invited">After all verified invitees answer</option></select></label>{rule === "count" ? <label>Responses needed<input type="number" required min={1} max={500} value={count} onChange={event => setCount(event.target.value)} /></label> : null}{rule === "deadline" ? <label>Deadline · your local time<input type="datetime-local" required value={deadline} onChange={event=>setDeadline(event.target.value)} /></label> : null}<p className="review-caption">Link polls use a count, deadline or manual finish. A deadline advances only while the event worker operates; you can always finish collection explicitly. Names alone cannot establish attendance or named coverage.</p><button className="cm-action" disabled={controller.pending}>Link this poll</button></form> : null}
      {activeStep?.kind === "poll" && activeStep.refId && !terminal(goal) ? <button type="button" className="cm-action" disabled={controller.pending} onClick={() => void run({ op: "finish_collection" })}>Finish collection</button> : null}
      {activeStep?.kind === "plan_action" && !activeStep.refId && review ? <button type="button" className="cm-action" disabled={controller.pending} onClick={() => void run({ op: "link_proposal", turnId: review.id })}>Use this review for the task</button> : null}
    </> : goal.errorCode === "workflow_archived" ? <p className="review-caption">Restore the deleted draft to continue this goal.</p> : <p className="review-caption">Only {goal.requestedByName} can change or cancel this {goal.kind === "planning" ? "goal" : "task"}.</p>}
  </section>;
}

export function GoalMainReports({ reports, onOpen }: { reports: GoalReport[]; onOpen: (id: string) => void }) {
  return <>{reports.slice().reverse().map(report => <article className="review-turn" key={report.id}><p className="review-coordinator">Commons · {report.goalTitle}{report.superseded ? " · Earlier result" : ""}</p><p className="review-caption"><time dateTime={report.createdAt}>{new Date(report.createdAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC</time></p><p>{report.headline}</p>{report.detail && !report.headline.endsWith(report.detail) ? <p>{report.detail}</p> : null}<button type="button" className="cm-action" onClick={() => onOpen(report.threadId)}>Open task</button></article>)}</>;
}
