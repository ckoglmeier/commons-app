"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { TripTaskSchema, type TripTask, type CommonsParticipant, type CommonsState, type CommonsSummary } from "@commons/contracts";
import { ModalLayer } from "./modal-layer";
import { CloseIcon } from "./icons";
import { thingsToDo, coordinatorNextSteps, type ThingToDo } from "@commons/domain";
import { useTripTaskIntakes } from "./use-trip-task-intakes";
import { commonsViewPath, itemDetailPath } from "@/lib/commons-route";
export type TripTaskContext = {
    people: CommonsParticipant[];
    state: CommonsState;
    commons: CommonsSummary;
    organizer: boolean;
    confirmationIntakeEnabled?: boolean;
};
export function TripTasks({ slug, actorId, context, onOpenPollResults, onTasksLoaded, onSuggestions, showSuggestions = true }: {
    /** False where the same suggestions are already listed on the page (Trip's What’s next). */
    showSuggestions?: boolean;
    /** The current suggested to-dos, for next-step actions elsewhere. Same list, targets and permissions. */
    onSuggestions?: (suggestions: ThingToDo[]) => void;
    onOpenPollResults?: (id: string) => void;
    onTasksLoaded?: (tasks: TripTask[]) => void;
    slug: string;
    actorId?: string;
    context?: TripTaskContext;
}) {
    const [tasks, setTasks] = useState<TripTask[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [open, setOpen] = useState(false);
    const [draft, setDraft] = useState({ title: "", ownerPersonId: actorId ?? "", dueOn: "", item: "" });
    const [tasksLoaded, setTasksLoaded] = useState(false);
    const [now, setNow] = useState<number | null>(null);
    useEffect(() => { const update = () => setNow(Date.now()); const first = window.setTimeout(update,0); const timer = window.setInterval(update,60000); return () => {window.clearTimeout(first);window.clearInterval(timer);}; }, []);
    const {intakes,intakeState} = useTripTaskIntakes(slug,Boolean(context?.confirmationIntakeEnabled));
    const [editing, setEditing] = useState<TripTask | null>(null);
    const pendingRequest = useRef<{
        fingerprint: string;
        body: Record<string, unknown>;
    } | null>(null);
    const storageKey = `commons:${slug}:${actorId}:human-task-draft`;
    useEffect(() => {
        let live = true;
        const load = () => { void fetch(`/api/v1/commons/${slug}/tasks`, {cache:"no-store"}).then(async response => {
            if (!response.ok) throw new Error(); return response.json();
        }).then(value => { if (live) { const loaded = z.array(TripTaskSchema).parse(value.tasks); setTasks(loaded); setTasksLoaded(true); onTasksLoaded?.(loaded); } }).catch(() => { if (live) setError("Couldn’t load to-dos. Refresh to try again."); }); };
        load(); const timer = window.setInterval(load,15000);
        window.addEventListener("focus",load); window.addEventListener("commons:trip-tasks-changed",load);
        return () => {live=false;window.clearInterval(timer);window.removeEventListener("focus",load);window.removeEventListener("commons:trip-tasks-changed",load);};
    },[slug, actorId, onTasksLoaded]);
    useEffect(()=>{if(!tasksLoaded)return;const id=new URLSearchParams(window.location.search).get("todo");if(!id || !tasks.some(task=>task.id===id))return;const target=document.getElementById(`trip-todo-${id}`) as HTMLDetailsElement|null;if(target){target.open=true;target.scrollIntoView({block:"nearest"});}},[tasksLoaded,tasks]);
    // Restore the private browser draft after hydration; it is external state.
    useEffect(() => { try {
        const value = sessionStorage.getItem(storageKey);
        if (value) {
            const parsed = z.object({ title: z.string(), ownerPersonId: z.string(), dueOn: z.string(), item: z.string(), editing: TripTaskSchema.nullable().optional() }).parse(JSON.parse(value));
            const { editing: restoredEditing, ...fields } = parsed;
            // Hydrate the external, private session draft without saving it to the trip.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setDraft(fields);
            setEditing(restoredEditing ?? null);
        }
    }
    catch { /* Storage is optional; the mounted draft remains available. */ } }, [storageKey]);
    function change(value: Partial<typeof draft>, editingOverride = editing) { pendingRequest.current = null; try {
        sessionStorage.removeItem(`${storageKey}:request`);
    }
    catch { /* Storage is optional; the mounted draft remains available. */ } setDraft(current => { const next = { ...current, ...value }; try {
        sessionStorage.setItem(storageKey, JSON.stringify({ ...next, editing: editingOverride }));
    }
    catch { /* Storage is optional; the mounted draft remains available. */ } return next; }); }
    const items = context ? [
        ...context.state.itinerary.map(item => ({ key: `plan:${item.id}`, title: item.title })),
        ...(context.state.stays ?? []).map(item => ({ key: `stay:${item.id}`, title: item.name })),
        ...(context.state.travelPlans ?? []).filter(item => item.visibility !== "private").map(item => ({ key: `travel:${item.id}`, title: item.route })),
    ] : [];
    const suggestions = context && actorId && now !== null && tasksLoaded && !error ? thingsToDo({tripId:context.commons.id,personId:actorId,organizer:context.organizer,state:context.state,tripTasks:tasks,today:new Intl.DateTimeFormat("en-CA",{timeZone:context.commons.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now)),travel:coordinatorNextSteps({commons:context.commons,state:context.state,participants:context.people,personId:actorId,now,travelState:"loaded",intakes,intakeState}).steps[0]}).filter(item=>item.target.kind !== "todo") : [];
    const suggestionKey = (suggestions ?? []).map(suggestion => suggestion.id).join("|");
    // Report only when the set of suggestions changes, not on every render that recomputes the same list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { onSuggestions?.(suggestions ?? []); }, [suggestionKey, onSuggestions]);
    async function save(task?: TripTask) {
        setBusy(true);
        setError("");
        const [itemKind, itemId] = draft.item.split(":");
        const body = task ? { ...task, completed: !task.completed, expectedVersion: task.version } : { ...draft, dueOn: draft.dueOn || null, itemKind: itemKind || null, itemId: itemId || null, id: editing?.id ?? crypto.randomUUID(), expectedVersion: editing?.version ?? 0, completed: editing?.completed ?? false };
        const fingerprint = JSON.stringify(task ? [task.id, task.version, !task.completed] : [draft, editing?.id, editing?.version]);
        try {
            if (!pendingRequest.current) {
                const stored = JSON.parse(sessionStorage.getItem(`${storageKey}:request`) ?? "null");
                if (stored?.fingerprint === fingerprint)
                    pendingRequest.current = stored;
            }
        }
        catch { /* Storage is optional; the mounted draft remains available. */ }
        try {
            const { title, ownerPersonId, dueOn, id, expectedVersion, completed, itemKind, itemId } = body;
            if (pendingRequest.current?.fingerprint !== fingerprint)
                pendingRequest.current = { fingerprint, body: { commandId: crypto.randomUUID(), title, ownerPersonId, dueOn, id, expectedVersion, completed, itemKind, itemId } };
            try {
                sessionStorage.setItem(`${storageKey}:request`, JSON.stringify(pendingRequest.current));
            }
            catch { /* Storage is optional; the mounted draft remains available. */ }
            const response = await fetch(`/api/v1/commons/${slug}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(pendingRequest.current.body) });
            const value = await response.json();
            if (!response.ok)
                throw new Error(value.error);
            const saved = TripTaskSchema.parse(value.task);
            pendingRequest.current = null;
            try {
                sessionStorage.removeItem(`${storageKey}:request`);
            }
            catch { /* Storage is optional; the mounted draft remains available. */ }
            setTasks(current => [...current.filter(item => item.id !== saved.id), saved]);
            window.dispatchEvent(new Event("commons:trip-tasks-changed"));
            if (!task) {
                setOpen(false);
                setEditing(null);
                change({ title: "", dueOn: "", item: "" }, null);
            }
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : "To-do not saved.");
        }
        finally {
            setBusy(false);
        }
    }
    const openTasks = tasks.filter(task => !task.completed);
    return <section className="trip-tasks" aria-label="Trip to-dos"><div className="event-logistics-heading"><h3>To-dos</h3>{context ? <button className="cm-action" type="button" onClick={() => { setOpen(true); }}>{editing ? "Resume to-do" : "Add to-do"}</button> : null}</div>
    {error ? <p role="alert">{error}</p> : null}
    {!openTasks.length && !error ? <p className="review-caption">{tasksLoaded ? "No open to-dos." : "Checking to-dos…"}</p> : null}
    {[...openTasks].sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999")).map(task => <details key={task.id} id={`trip-todo-${task.id}`} className="trip-task"><summary>{task.completed ? "✓ " : ""}{task.title}</summary><p>{task.suggestedByCommons ? "Suggested by Commons · " : ""}{context?.people.find(person => person.id === task.ownerPersonId)?.displayName ?? "Assigned traveler"}{context?.people.find(person => person.id === task.ownerPersonId)?.membershipStatus === "invited" ? " · Invited · attendance not confirmed" : ""}{task.dueOn ? ` · Due ${task.dueOn}` : ""}</p>{task.itemKind && task.itemId ? <a href={task.itemKind === "travel" ? `${commonsViewPath(slug, "logistics")}&travelId=${encodeURIComponent(task.itemId)}` : itemDetailPath(slug, task.itemKind, task.itemId)}>{task.itemTitle}</a> : null}<div><button className="cm-action" type="button" disabled={busy} onClick={() => void save(task)}>{task.completed ? "Reopen" : "Mark complete"}</button>{context ? <button className="cm-action" type="button" onClick={() => { setEditing(task); change({ title: task.title, ownerPersonId: task.ownerPersonId, dueOn: task.dueOn ?? "", item: task.itemKind && task.itemId ? `${task.itemKind}:${task.itemId}` : "" }, task); setOpen(true); }}>Edit</button> : null}</div></details>)}
    {showSuggestions && suggestions.length ? <div className="trip-task-suggestions"><p className="review-caption">Suggested by Commons</p>{suggestions.map(suggestion => {
      return <div key={suggestion.id}><p>{suggestion.title}</p><p className="review-caption">{suggestion.detail}</p><SuggestionAction suggestion={suggestion} slug={slug} context={context} onOpenPollResults={onOpenPollResults} /></div>;
    })}</div> : null}
    {open && context ? <ModalLayer close={() => setOpen(false)}><section className="sheet" role="dialog" aria-modal="true" aria-labelledby="trip-task-title"><header className="sheet-header"><h2 id="trip-task-title">{editing ? "Edit to-do" : "New to-do"}</h2><button type="button" aria-label="Close to-do editor" onClick={() => setOpen(false)}><CloseIcon /></button></header><form onSubmit={event => { event.preventDefault(); void save(); }}><label className="field"><span>To-do</span><input required maxLength={160} value={draft.title} onChange={event => change({ title: event.target.value })} placeholder="Arrange airport van"/></label><label className="field"><span>Owner</span><select required value={draft.ownerPersonId} onChange={event => change({ ownerPersonId: event.target.value })}><option value="">Choose a person</option>{context.people.filter(person => ["active", "invited"].includes(person.membershipStatus) && (context.organizer || person.id === actorId)).map(person => <option key={person.id} value={person.id}>{person.displayName}{person.membershipStatus === "invited" ? " · Invited" : ""}</option>)}</select></label><details className="entry-more-details" open={Boolean(editing?.dueOn || editing?.itemId)}><summary>More details</summary><label className="field"><span>Due date <small>Optional</small></span><input type="date" value={draft.dueOn} onChange={event => change({ dueOn: event.target.value })}/></label><label className="field"><span>Related trip item <small>Optional</small></span><select value={draft.item} onChange={event => change({ item: event.target.value })}><option value="">No linked item</option>{items.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}</select></label></details><p className="expense-mode-help">Saving a to-do doesn’t change the plan.</p>{error ? <p role="alert">{error}</p> : null}<button className="sheet-primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save to-do"}</button></form></section></ModalLayer> : null}
  </section>;
}

/** The one control for a suggested to-do: an in-app action when the host supports it, otherwise a link to where it is done. */
export function SuggestionAction({ suggestion, slug, context, onOpenPollResults, className = "cm-action", label = suggestion.action }: {
    suggestion: ThingToDo; slug: string; context?: TripTaskContext; onOpenPollResults?: (id: string) => void; className?: string; label?: string;
}) {
    const poll = (suggestion.target.kind === "poll" || suggestion.target.kind === "poll_results") ? context?.state.pollRequests?.find(poll => poll.id === suggestion.target.id) : undefined;
    const href = suggestion.target.kind === "poll_results" ? `/c/${slug}/polls/${encodeURIComponent(suggestion.target.id)}` : poll ? poll.canManage ? `/c/${slug}/polls/${poll.id}` : `/c/poll/${poll.publicId}` : suggestion.target.kind === "proposal" ? commonsViewPath(slug,"plan") : `${commonsViewPath(slug,"logistics")}${suggestion.target.kind === "travel_item" ? `&travelId=${encodeURIComponent(suggestion.target.id)}` : ""}`;
    if (suggestion.target.kind === "poll_results" && onOpenPollResults) return <button className={className} type="button" onClick={() => onOpenPollResults(suggestion.target.id)}>{label}</button>;
    return <a className={className} href={href}>{label}</a>;
}
