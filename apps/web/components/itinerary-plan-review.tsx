"use client";
import { useEffect, useRef, useState } from "react";
import { chosenShortlistOption, itineraryPlanFields, planFieldChanges, type ItineraryDraft, type ItineraryItem, type PlanUpdateField } from "@commons/contracts";
import { clockTime } from "@/lib/clock-time";

type Item = ItineraryDraft["content"]["items"][number];
export type PlanUpdateSelection = { candidateId: string; savedId: string; expectedRecordVersion: string; fields: PlanUpdateField[] };
export type ArrangementTask = { title: string; itemId: string; ownerPersonId: string };
const FIELD_LABEL: Record<PlanUpdateField, string> = { title: "Name", date: "Day", time: "Start", duration: "Length", location: "Location", sourceUrl: "Source link" };

/** The saved record's reviewable fields, in the trip's local time. */
export function savedPlanFields(record: ItineraryItem, timezone: string) {
  const local = record.startsAt ? new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).formatToParts(new Date(record.startsAt)) : null;
  const part = (type: string) => local?.find(row => row.type === type)?.value;
  return { title: record.title, date: record.scheduledDate ?? (local ? `${part("year")}-${part("month")}-${part("day")}` : null), time: local ? `${part("hour")}:${part("minute")}` : null,
    durationMinutes: record.durationMinutes ?? null, location: record.location ?? null, sourceUrl: record.sourceUrl ?? null };
}
function show(field: PlanUpdateField, value: string | number | null) {
  if (value === null || value === "") return "Not set";
  if (field === "time" && typeof value === "string") return clockTime(value);
  if (field === "duration" && typeof value === "number") return value % 60 ? `${Math.floor(value / 60) ? `${Math.floor(value / 60)} hr ` : ""}${value % 60} min` : `${value / 60} hr`;
  return String(value);
}

/**
 * A separate organizer review after group input; it never publishes. Additions,
 * field-level updates to saved records and arrangement tasks are three distinct,
 * exact approvals. Group answers inform these choices; they approve nothing.
 */
export function ItineraryPlanReview({ draft, currentVersion, disabled, onBack, onApply, planItems = [], people = [], onUpdate, onTask }: {
  draft: ItineraryDraft; currentVersion: number; disabled: boolean; onBack: () => void;
  onApply: (ids: string[], version: number) => Promise<void>;
  /** Canonical Plan records, read from the permitted trip state. */
  planItems?: ItineraryItem[];
  /** Eligible task owners: active or invited travelers. */
  people?: Array<{ id: string; name: string; invited?: boolean }>;
  onUpdate?: (updates: PlanUpdateSelection[], version: number) => Promise<void>;
  onTask?: (task: ArrangementTask, version: number) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]), [confirming, setConfirming] = useState<null | "add" | "update" | "task">(null);
  const [updateIds, setUpdateIds] = useState<string[]>([]);
  const [taskItem, setTaskItem] = useState(""), [taskTitle, setTaskTitle] = useState(""), [taskOwner, setTaskOwner] = useState("");
  const [saving, setSaving] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");
  const inFlight = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [confirming]);
  const saved = new Set(draft.receipts.map(receipt => receipt.candidateId));
  // Activities and meal stops. A shortlist decision is eligible only after the organizer chose an option;
  // transport and existing records keep their own forms.
  const open = draft.content.items.filter(item => !saved.has(item.id) && item.decision && !chosenShortlistOption(item) && !item.travelAnchor && item.kind !== "transport" && item.kind !== "downtime");
  const candidates = draft.content.items.filter(item => !saved.has(item.id) && !item.travelAnchor && item.kind !== "transport" && item.kind !== "downtime" && item.evidence !== "saved_fact" && !item.alternative && (!item.decision || chosenShortlistOption(item)));
  const rows = candidates.filter(item => selected.includes(item.id));
  const updates = draft.receipts.filter(receipt => receipt.kind === "plan").flatMap(receipt => {
    const item = draft.content.items.find(row => row.id === receipt.candidateId), record = planItems.find(row => row.id === receipt.savedId);
    if (!item || !record || !record.version || record.status === "cancelled" || item.decision && !chosenShortlistOption(item)) return [];
    const changes = planFieldChanges(itineraryPlanFields(item, draft.evidence), savedPlanFields(record, draft.facts.timezone));
    return changes.length ? [{ item, record, receipt, changes }] : [];
  });
  const chosenUpdates = updates.filter(row => updateIds.includes(row.item.id));
  const savedPlans = draft.receipts.filter(receipt => receipt.kind === "plan").flatMap(receipt => { const item = draft.content.items.find(row => row.id === receipt.candidateId); return item ? [{ item, receipt }] : []; });
  const savedTasks = draft.receipts.filter(receipt => receipt.kind === "task").flatMap(receipt => { const task = draft.content.tasks.find(row => row.id === receipt.candidateId); return task ? [task] : []; });
  const stale = currentVersion !== draft.version;
  const busy = disabled || saving;
  const owner = people.find(person => person.id === taskOwner), linkedItem = savedPlans.find(row => row.item.id === taskItem);
  // Only a saved task blocks a duplicate; an unsaved row from a failed approval is reused on retry.
  const duplicateTask = Boolean(taskTitle.trim()) && savedTasks.some(task => task.itemId === taskItem && task.title.trim().toLowerCase() === taskTitle.trim().toLowerCase());
  async function run(action: () => Promise<void>, success: string) {
    if (inFlight.current || busy || stale) return;
    inFlight.current = true; setSaving(true); setError(""); setDone("");
    try { await action(); setDone(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Saving was not confirmed. Your selections are still here."); }
    finally { inFlight.current = false; setSaving(false); }
  }
  const details = (item: Item) => `${item.day ?? "No day"} · ${item.time ? clockTime(item.time) : "No time"}${item.endTime ? `–${clockTime(item.endTime)}` : ""} · ${item.day ? "Planned" : "Idea"}, unconfirmed · ${item.participation === "optional" ? "Whoever wants to join" : "Everyone"}`;
  const sourceLinks = (item: Item) => { const chosen = chosenShortlistOption(item); return (chosen?.sources ?? item.sources).map(ref => { const source = draft.evidence.find(row => row.runId === ref.runId && row.sourceId === ref.sourceId); return source ? <a className="cm-action" key={`${ref.runId}:${ref.sourceId}`} href={source.url} target="_blank" rel="noreferrer">{source.title}{"basis" in ref && ref.basis === "secondary" ? " (secondary source)" : ""}</a> : null; }); };
  const back = <button type="button" className="cm-action" disabled={busy} onClick={() => { if (confirming) { setConfirming(null); setError(""); } else onBack(); }}>{confirming ? "Change selection" : "Back to itinerary"}</button>;

  if (confirming === "update") return <section className="workspace-work-section workspace-itinerary" aria-label="Approve updates to saved activities">
    <h3 tabIndex={-1} ref={heading}>You are approving these updates</h3>
    <p>Only the fields shown change. Notes, costs, booking details, arranger and who is included stay as they are in Plan. Nothing is booked or confirmed.</p>
    {stale ? <p role="alert">The itinerary changed. Return to the document and review the current version before saving.</p> : null}
    {chosenUpdates.map(({ item, changes }) => <div key={item.id}><h4>{item.title}</h4><ul>{changes.map(change => <li key={change.field}>{FIELD_LABEL[change.field]}: {show(change.field, change.from)} → {show(change.field, change.to)}</li>)}</ul></div>)}
    {error ? <p role="alert">{error}</p> : null}
    <div className="workspace-actions">{back}<button type="button" className="cm-action cm-action--primary" disabled={busy || stale || !chosenUpdates.length || !onUpdate} onClick={() => void run(() => onUpdate!(chosenUpdates.map(({ item, record, receipt, changes }) => ({ candidateId: item.id, savedId: receipt.savedId, expectedRecordVersion: record.version!, fields: changes.map(change => change.field) })), draft.version), "Updates saved to Plan. Nothing was booked.")}>{saving ? "Saving…" : "Save selected updates"}</button></div>
  </section>;

  if (confirming === "task") return <section className="workspace-work-section workspace-itinerary" aria-label="Approve arrangement task">
    <h3 tabIndex={-1} ref={heading}>You are approving this task</h3>
    <p><strong>{taskTitle.trim()}</strong></p>
    <p className="review-caption">Owner: {owner?.name}{owner?.invited ? " · Invited · attendance not confirmed" : ""} · Linked to {linkedItem?.item.title}. A task is a reminder for a person. Saving it books or confirms nothing and sends no message.</p>
    {stale ? <p role="alert">The itinerary changed. Return to the document and review the current version before saving.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="workspace-actions">{back}<button type="button" className="cm-action cm-action--primary" disabled={busy || stale || !owner || !linkedItem || !onTask} onClick={() => void run(async () => { await onTask!({ title: taskTitle.trim(), itemId: taskItem, ownerPersonId: taskOwner }, draft.version); setTaskTitle(""); setTaskOwner(""); setTaskItem(""); }, "Task saved. Nothing was booked or sent.")}>{saving ? "Saving…" : "Save task"}</button></div>
  </section>;

  return <section className="workspace-work-section workspace-itinerary" aria-label="Review additions to Plan">
    <h3 tabIndex={-1} ref={heading}>{confirming === "add" ? "You are approving these additions" : "Review additions to Plan"}</h3>
    <p>From {draft.content.title} · Private draft {draft.version}. Group answers inform your choice; they do not approve these additions.</p>
    <p>Selected stops become activities in Plan, with the day, time, location, and participation shown here. Nothing is booked, confirmed, or sent. Private planning notes stay private.</p>
    {stale ? <p role="alert">The itinerary changed. Return to the document and review the current version before saving.</p> : null}
    {done ? <p role="status">{done}</p> : null}
    {!candidates.length ? <p>No new activity stops are ready to add. Resolve open choices in the itinerary first.</p> : null}
    <fieldset className="itinerary-review-choices" disabled={busy || stale}><legend>{confirming === "add" ? "Additions" : "Choose activities to add"}</legend>
      {(confirming === "add" ? rows : candidates).map(item => { const chosen = chosenShortlistOption(item), fields = itineraryPlanFields(item, draft.evidence); return <div key={item.id}>
        {confirming === "add" ? <h4>{fields.title}</h4> : <label><input type="checkbox" checked={selected.includes(item.id)} onChange={event => setSelected(value => event.target.checked ? [...value, item.id] : value.filter(id => id !== item.id))} /><span>{fields.title}</span></label>}
        <p className="review-caption">{details(item)}{fields.location ? ` · ${fields.location}` : " · Location not set"}{item.kind === "meal" ? " · Meal" : ""}</p>
        {chosen ? <p>Chosen by an organizer · {chosen.fit === "candidate" ? "fits the known rules" : "still needs confirmation"}. Not booked.</p> : null}
        {[...item.unresolved, ...(chosen?.unknowns ?? [])].length ? <p>Still open: {[...item.unresolved, ...(chosen?.unknowns ?? [])].join("; ")}</p> : null}
        {sourceLinks(item)}
      </div>; })}
    </fieldset>
    {confirming !== "add" && open.length ? <section className="itinerary-review-lane" aria-label="Open decisions"><h4>Still to decide</h4><p className="review-caption">Choose an option in the itinerary before it can be added. Group preferences never choose for you.</p><ul>{open.map(item => <li key={item.id}>{item.title} · {item.decision!.options.join(", ")}</li>)}</ul></section> : null}
    {error && confirming === "add" ? <p role="alert">{error}</p> : null}
    <div className="workspace-actions">
      {back}
      {confirming === "add" ? <button type="button" className="cm-action cm-action--primary" disabled={busy || stale || !rows.length} onClick={() => void run(() => onApply(rows.map(item => item.id), draft.version), "Selected activities saved to Plan. Nothing was booked.")}>{saving ? "Saving…" : "Save selected activities"}</button> : <button type="button" className="cm-action cm-action--primary" disabled={busy || stale || !rows.length} onClick={() => setConfirming("add")}>Review {rows.length} {rows.length === 1 ? "addition" : "additions"}</button>}
    </div>
    {confirming !== "add" && onUpdate ? <section className="itinerary-review-lane" aria-label="Updates to saved activities"><h4>Updates to saved activities</h4>
      {!updates.length ? <p className="review-caption">Saved activities match this itinerary.</p> : <fieldset className="itinerary-review-choices" disabled={busy || stale}><legend>Choose updates to apply</legend>{updates.map(({ item, changes }) => <div key={item.id}>
        <label><input type="checkbox" checked={updateIds.includes(item.id)} onChange={event => setUpdateIds(value => event.target.checked ? [...value, item.id] : value.filter(id => id !== item.id))} /><span>{item.title}</span></label>
        <ul className="review-caption">{changes.map(change => <li key={change.field}>{FIELD_LABEL[change.field]}: {show(change.field, change.from)} → {show(change.field, change.to)}</li>)}</ul>
      </div>)}</fieldset>}
      {updates.length ? <div className="workspace-actions"><button type="button" className="cm-action cm-action--primary" disabled={busy || stale || !chosenUpdates.length} onClick={() => setConfirming("update")}>Review {chosenUpdates.length} {chosenUpdates.length === 1 ? "update" : "updates"}</button></div> : null}
    </section> : null}
    {confirming !== "add" && onTask && savedPlans.length ? <section className="itinerary-review-lane" aria-label="Arrangement tasks"><h4>Arrangement tasks</h4>
      <p className="review-caption">Optional. Ask a specific person to arrange a saved activity. A preference or vote never assigns anyone.</p>
      {savedTasks.length ? <ul>{savedTasks.map(task => <li key={task.id}>{task.title} · saved</li>)}</ul> : null}
      <fieldset disabled={busy || stale}><legend>Add a task</legend>
        <label>Activity<select value={taskItem} onChange={event => { setTaskItem(event.target.value); const row = savedPlans.find(entry => entry.item.id === event.target.value); if (row && !taskTitle) setTaskTitle(`Arrange ${itineraryPlanFields(row.item, draft.evidence).title}`.slice(0, 160)); }}><option value="">Choose a saved activity</option>{savedPlans.map(({ item }) => <option key={item.id} value={item.id}>{itineraryPlanFields(item, draft.evidence).title}</option>)}</select></label>
        <label>Task<input maxLength={160} value={taskTitle} onChange={event => setTaskTitle(event.target.value)} /></label>
        <label>Who will do this?<select value={taskOwner} onChange={event => setTaskOwner(event.target.value)}><option value="">Choose a person</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}{person.invited ? " (invited)" : ""}</option>)}</select></label>
        {duplicateTask ? <p role="status">This task is already in the itinerary for that activity.</p> : null}
      </fieldset>
      <div className="workspace-actions"><button type="button" className="cm-action" disabled={busy || stale || !taskItem || !taskTitle.trim() || !owner || duplicateTask} onClick={() => setConfirming("task")}>Review task</button></div>
    </section> : null}
    {error && !confirming ? <p role="alert">{error}</p> : null}
  </section>;
}
