"use client";
import { itineraryPublishedPreferences, type PublishedPreferences } from "@/lib/itinerary-published-preferences";
import { ItineraryPlanReview, type PlanUpdateSelection, type ArrangementTask } from "./itinerary-plan-review";
import { ItineraryShortlistEditor } from "./itinerary-shortlist-editor";
import { CoordinatorRequestError } from "@/lib/coordinator-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ItineraryDocumentRevisionSchema, itineraryParticipantDraft, requalifyShortlist, decisionScopeFor, shortlistError, PollDetailSchema, CommonsSnapshotSchema, type CommonsSnapshot, type PollDetail, type ItineraryDraft, type ItineraryContent, type PollWorkingDraft, type ItineraryPollSnapshot } from "@commons/contracts";
import { ItineraryDocumentAutosave, type DocumentSave, type DocumentState } from "@/lib/itinerary-document-autosave";
import { TimeInput } from "./time-input";
import { commonsViewPath, itemDetailPath } from "@/lib/commons-route";
import { ItineraryTimeline } from "./itinerary-timeline";
import { itineraryProjectionId } from "@/lib/itinerary-message";
import { itineraryQuestion } from "@/lib/itinerary-workshop";
import { ItineraryMessage } from "./itinerary-message";
import { ItineraryPublishConfirmation } from "./itinerary-publish-confirmation";
import { ItineraryShareDialog } from "./itinerary-share-dialog";
import { publishItineraryDraft, type ItineraryPublicationAttempt } from "@/lib/itinerary-publication-client";
import { publicPollPath } from "@/lib/poll-route";
import { ItineraryFeedbackResults } from "./itinerary-feedback-results";
import { itineraryResults } from "@/lib/itinerary-workshop";
import { ItineraryPortabilityPanel } from "./itinerary-portability-panel";
import type { ItineraryImportReceipt } from "@commons/contracts";

export type ItineraryReviewAction = { reviewedVersion?: number; operation: "revise" | "undo" | "apply" | "remove_import" | "prepare_poll" | "update_plan" | "link_existing"; revisionCommandId?: string; undoItemId?: string; content?: ItineraryContent; selectedIds?: string[]; taskIds?: string[]; importId?: string; taskOwners?: Array<{ taskId: string; ownerPersonId: string }>;
  planUpdates?: PlanUpdateSelection[]; planItemId?: string; expectedRecordVersion?: string };
export function CoordinatorItinerary({ activityDecisionsEnabled = false, draft, current, slug, actorId, disabled, onAction, onSave, onReady, turnId, onDirtyChange, sharingDraft, sharingPublicId, hasPublishedVersion = false, latestPublishedPollId, onSharingChanged, portability }: {
  activityDecisionsEnabled?: boolean;
  draft: ItineraryDraft; turnId: string; current: boolean; slug: string; actorId?: string; disabled: boolean;
  /** The newest published round of this document, for organizer-only preference display. */
  latestPublishedPollId?: string;
  sharingDraft?: PollWorkingDraft; sharingPublicId?: string; hasPublishedVersion?: boolean; onSharingChanged?: (pollId:string)=>Promise<void>;
  onOpenVote?: (draftId: string) => void;
  onSave: (request: DocumentSave) => Promise<DocumentState>;
  onReady?: (flush: (() => Promise<DocumentState>) | null) => void;
  onAction: (action: ItineraryReviewAction) => Promise<PollWorkingDraft | void>;
  onDirtyChange?: (dirty: boolean) => void;
  /** Markdown export and reviewed re-import; absent while that feature is off. */
  portability?: { seed: { text: string; token: string } | null; onApplyStart: () => (receipt: ItineraryImportReceipt) => Promise<void> };
}) {
  const [planReview, setPlanReview] = useState<ItineraryDraft | null>(null), [savedReview, setSavedReview] = useState<false | "added" | "updated" | "task">(false);
  const [trip, setTrip] = useState<CommonsSnapshot | null>(null), [poll, setPoll] = useState<PollDetail | null>(null), [linkId, setLinkId] = useState("");
  // Fresh permitted trip state (Plan records with version tokens, eligible people) for exact reviews.
  const loadTrip = async () => { const response = await fetch(`/api/v1/commons/${slug}/state`, { cache: "no-store" }); if (!response.ok) throw new Error("Plan could not load. Nothing was changed."); const snapshot = CommonsSnapshotSchema.parse((await response.json()).snapshot); setTrip(snapshot); return snapshot; };
  useEffect(() => {
    if (!latestPublishedPollId) return;
    const controller = new AbortController();
    void fetch(`/api/v1/commons/${slug}/polls/${latestPublishedPollId}`, { cache: "no-store", signal: controller.signal }).then(async response => { if (response.ok) setPoll(PollDetailSchema.parse((await response.json()).poll)); }).catch(() => {});
    return () => controller.abort();
  }, [slug, latestPublishedPollId]);
  const pollResults = useMemo(() => poll && poll.id === latestPublishedPollId ? itineraryResults(poll) : null, [poll, latestPublishedPollId]);
  const [preferences, setPreferences] = useState<{ source: typeof pollResults; documentId: string; rows: PublishedPreferences } | null>(null);
  useEffect(() => {
    let current = true;
    void itineraryPublishedPreferences(draft.id, draft.content.items, pollResults).then(rows => { if (current) setPreferences({ source: pollResults, documentId: draft.id, rows }); }).catch(() => {});
    return () => { current = false; };
  }, [draft.id, draft.content.items, pollResults]);
  const optionResults = (item: ItineraryContent["items"][number]) => preferences?.source === pollResults && preferences?.documentId === draft.id && preferences.rows[item.id]?.length ? preferences.rows[item.id] : null;
  const missing = poll?.identityBound && poll.audienceReview && pollResults ? Math.max(0, poll.audienceReview.personIds.length + poll.audienceReview.guestEmails.length - pollResults.responses.length) : null;
  const planOpener = useRef<HTMLButtonElement>(null), savedReceipt = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (savedReview) savedReceipt.current?.focus(); }, [savedReview, draft.receipts.length]);
  const [confirming, setConfirming] = useState(false), [sharingBusy, setSharingBusy] = useState(false), [showResults, setShowResults] = useState(false);
  const [access, setAccess] = useState<"invitees" | "link">("invitees");
  const [share, setShare] = useState<{url:string; data:PollWorkingDraft["data"]; access:"invitees"|"link"}|null>(null);
  const pendingPublication = useRef<ItineraryPublicationAttempt|null>(null), publishing = useRef(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [newTitle, setNewTitle] = useState(""), [newDay, setNewDay] = useState(draft.facts.startsOn ?? ""), [newTime, setNewTime] = useState("");
  const [dayStops, setDayStops] = useState<Record<string,string>>({});
  const [questionText, setQuestionText] = useState("");
  const [deleted, setDeleted] = useState<{ before: ItineraryContent; after: ItineraryContent } | null>(null);
  const [controller, setController] = useState<ItineraryDocumentAutosave | null>(null), [, render] = useState(0);
  const saveRef = useRef(onSave); useEffect(() => { saveRef.current = onSave; }, [onSave]);
  const storageKey = actorId && current ? `commons:${slug}:${actorId}:itinerary-document:${draft.id}` : null;
  useEffect(() => {
    let mounted = true;
    const frame = requestAnimationFrame(() => {
      let raw: string | null = null;
      try { raw = storageKey ? window.sessionStorage.getItem(storageKey) : null; } catch { /* Mounted text still works. */ }
      const next = new ItineraryDocumentAutosave({ draft, turnId }, request => saveRef.current(request), () => { if (mounted) render(value => value + 1); }, value => {
        try { if (storageKey) { if (value) window.sessionStorage.setItem(storageKey, value); else window.sessionStorage.removeItem(storageKey); } } catch { /* Keep mounted edits. */ }
      }, raw);
      setController(next);
    });
    return () => { mounted = false; cancelAnimationFrame(frame); };
    // The controller belongs to the stable actor/document, not its changing version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, draft.id]);
  useEffect(() => { controller?.receive({ draft, turnId }); }, [controller, draft, turnId]);
  useEffect(() => { onReady?.(controller ? () => controller.flush() : null); return () => onReady?.(null); }, [controller, onReady]);
  const content = controller?.content ?? draft.content;
  const dirty = controller?.dirty ?? false;
  const busy = disabled || sharingBusy || !current || !controller;
  const setContent = (value: ItineraryContent | ((old: ItineraryContent) => ItineraryContent)) => { controller?.edit(typeof value === "function" ? value(controller.content) : value); };
  useEffect(() => { if (current) onDirtyChange?.(dirty); return () => { if (current) onDirtyChange?.(false); }; }, [current, dirty, onDirtyChange]);
  useEffect(() => {
    if (!controller || controller.status !== "dirty" || disabled || !current) return;
    const timer = setTimeout(() => { void controller.flush().catch(() => {}); }, 650);
    return () => clearTimeout(timer);
  }, [controller, content, controller?.status, disabled, current]);
  const flush = async () => { if (!controller) throw new Error("Wait for the document to load."); return controller.flush(); };
  const deleteItem = (id: string) => {
    const before = structuredClone(content), after = { ...content, items: content.items.filter(item => item.id !== id) };
    if (content.tasks.some(task => task.itemId === id)) { setError("This stop has a linked planning task. Remove its link before deleting the draft mention."); return; }
    setDeleted({ before, after }); setContent(after);
  };
  const undoDelete = async () => {
    if (!deleted) return;
    try {
      await flush();
      const response = await fetch(`/api/v1/commons/${slug}/coordinator/itinerary-history?threadId=${draft.threadId}&documentId=${draft.id}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const revisions = ItineraryDocumentRevisionSchema.array().parse((await response.json()).revisions);
      const revision = revisions.find(row => row.before && deleted.before.items.some(item => !deleted.after.items.some(other => other.id === item.id) && row.before!.items.some(old => old.id === item.id) && !row.after.items.some(after => after.id === item.id)));
      if (!revision) throw new Error();
      await onAction({ operation: "undo", revisionCommandId: revision.commandId, undoItemId: deleted.before.items.find(item => !deleted.after.items.some(row => row.id === item.id))!.id }); setDeleted(null);
    } catch { setError("Undo could not be saved. Your current document is unchanged. Reload Work to review the draft, then try again."); }
  };
  const participantProjection = useMemo(() => { try { const ids = new Map<string,string>(); const data=itineraryParticipantDraft(content, key => { if (!ids.has(key)) ids.set(key, itineraryProjectionId(draft.id,key)); return ids.get(key)!; }, draft.evidence); return {data,ids}; } catch { return null; } }, [content,draft.id,draft.evidence]);
  const participantData=participantProjection?.data;
  function editOutline(snapshot: ItineraryPollSnapshot) {
    if(!participantProjection) return;
    const {ids}=participantProjection, original=itineraryQuestion(participantProjection.data.questions)!.itinerary;
    const stops=[...snapshot.days.flatMap(day=>day.items),...snapshot.otherIdeas], oldStops=[...original.days.flatMap(day=>day.items),...original.otherIdeas];
    setContent(value=>{
      const days=[...(value.days??[])];
      for(const section of snapshot.days) {
        const prior=original.days.find(row=>row.id===section.id), day=[...ids.entries()].find(([key,id])=>key.startsWith("day:") && id===section.id)?.[0].slice(4);
        if(!prior || !day || prior.description===section.description && prior.label===section.label) continue;
        const index=days.findIndex(row=>row.day===day), saved=days[index]??{day,description:""};
        const changed={...saved,...(prior.description!==section.description?{description:section.description}:{}),...(prior.label!==section.label?{label:section.label}:{})};
        if(index<0) days.push(changed);else days[index]=changed;
      }
      return {...value,title:snapshot.title===original.title?value.title:snapshot.title,...(snapshot.closing!==original.closing?{closing:snapshot.closing}:{}),...(days.length || value.days ? {days} : {}),items:value.items.map(item=>{
        const stop=stops.find(row=>row.id===ids.get(`item:${item.id}`)), prior=oldStops.find(row=>row.id===stop?.id);
        if(!stop || !prior || stop.title===prior.title && stop.details===prior.details) return item;
        const suffix=prior.title.slice(item.title.length),title=suffix && stop.title.endsWith(suffix)?stop.title.slice(0,-suffix.length):stop.title;
        return {...item,...(stop.title!==prior.title?{title}:{}),...(stop.details!==prior.details?{participantNote:stop.details}:{})};
      })};
    });
  }
  const saved = new Set(draft.receipts.map(item => item.candidateId));
  const voting = (item: ItineraryContent["items"][number]) => item.decision ? <section className="itinerary-vote-proposal" aria-label={`Voting choices for ${item.title}`}><h5>{item.decision.question}</h5><ul>{item.decision.options.map(option => <li key={option}>{option}</li>)}</ul><p className="review-caption">Proposed choices in the itinerary · Nothing shared. Preferences never book or confirm a stop.</p></section> : null;
  const change = (id: string, values: Partial<ItineraryContent["items"][number]>) => {
    setContent(value => ({ ...value, items: value.items.map(item => {
      if (item.id !== id) return item;
      const next = { ...item, ...values };
      // A different day or group size re-checks every option against its evidence.
      if (item.decision?.shortlist && ("day" in values || "partySize" in values) && (next.day !== item.day || next.partySize !== item.partySize)) {
        const shortlist = requalifyShortlist(item.decision.shortlist, draft.evidence, decisionScopeFor(item), decisionScopeFor(next));
        const chosen = shortlist.find(option => option.id === item.decision!.chosenOptionId);
        const decision = { ...item.decision, shortlist, options: shortlist.filter(option => option.inPoll && option.fit !== "unsuitable").map(option => option.label), chosenOptionId: chosen && chosen.fit !== "unsuitable" ? chosen.id : null };
        // Never save a shortlist the group cannot be asked about; keep the earlier scope and say why.
        if (shortlistError(decision)) { setError(`Fewer than two options would suit ${next.title} with that change. Nothing was changed; add or review options first.`); return item; }
        return { ...next, decision };
      }
      return next;
    }) }));
  };
  async function publish() {
    if (publishing.current || busy) return;
    publishing.current = true; setSharingBusy(true); setError("");
    try {
      await flush();
      const prepared = await onAction({operation:"prepare_poll"});
      if (!prepared || prepared.publishedPollId) throw new Error("This version is already published. Edit the private document before publishing changes.");
      // A later round of the same document links to the newest earlier round; each round keeps its own answers.
      const poll = await publishItineraryDraft(slug, prepared, access, pendingPublication, latestPublishedPollId);
      setConfirming(false);
      setShare({url:new URL(publicPollPath(poll.publicId),window.location.origin).href,data:prepared.data,access});
      try { await onSharingChanged?.(poll.id); } catch { setError("The itinerary is published. Refresh the conversation to see its saved link."); }
    } catch (cause) { setError(cause instanceof CoordinatorRequestError ? cause.error.userMessage : cause instanceof Error ? cause.message : "Publication was not confirmed. Retry after checking the saved document."); }
    finally { publishing.current=false; setSharingBusy(false); }
  }

  if (activityDecisionsEnabled && planReview) return <ItineraryPlanReview draft={planReview} currentVersion={draft.version} disabled={busy || dirty} planItems={trip?.state.itinerary ?? []}
    people={(trip?.participants ?? []).map(person => ({ id: person.id, name: person.displayName, invited: person.membershipStatus === "invited" }))}
    onBack={() => { setPlanReview(null); requestAnimationFrame(() => planOpener.current?.focus()); }} onApply={async (ids, version) => {
    await onAction({ operation: "apply", selectedIds: ids, taskIds: [], reviewedVersion: version });
    setPlanReview(null); setSavedReview("added");
    requestAnimationFrame(() => savedReceipt.current?.focus());
  }} onUpdate={async (updates, version) => {
    await onAction({ operation: "update_plan", planUpdates: updates, reviewedVersion: version });
    setPlanReview(null); setSavedReview("updated"); void loadTrip().catch(() => {});
    requestAnimationFrame(() => savedReceipt.current?.focus());
  }} onTask={async (task: ArrangementTask) => {
    // Two exact commands: a private draft edit adds the task row, then its own approval saves it with the named owner.
    const state = await flush();
    // A retry after a failed approval reuses the unsaved row instead of adding another.
    const savedTaskIds = new Set(state.draft.receipts.filter(receipt => receipt.kind === "task").map(receipt => receipt.candidateId));
    const unsaved = state.draft.content.tasks.find(row => !savedTaskIds.has(row.id) && row.itemId === task.itemId && row.title.trim().toLowerCase() === task.title.trim().toLowerCase());
    const id = unsaved?.id ?? crypto.randomUUID();
    if (!unsaved) await onAction({ operation: "revise", content: { ...state.draft.content, tasks: [...state.draft.content.tasks, { id, title: task.title, itemId: task.itemId }] } });
    await onAction({ operation: "apply", selectedIds: [], taskIds: [id], taskOwners: [{ taskId: id, ownerPersonId: task.ownerPersonId }] });
    setPlanReview(null); setSavedReview("task");
    requestAnimationFrame(() => savedReceipt.current?.focus());
  }} />;

  return <section className="workspace-work-section workspace-itinerary" aria-label="Itinerary draft">
    <div className="workspace-actions"><button type="button" className="cm-action" aria-expanded={editing} onClick={()=>setEditing(value=>!value)}>{editing ? "Done editing" : "Edit"}</button></div>
    {!editing && participantData ? <ItineraryMessage data={participantData} textLimits={{title:120,note:1000,day:1000}} disabled={busy} onTitleChange={title=>setContent(value=>({...value,title}))} onOpeningChange={opening=>setContent(value=>({...value,opening}))} onItineraryChange={editOutline} /> : null}
    {editing ? <><label className="itinerary-document-title"><span className="sr-only">Itinerary title</span><input aria-label="Itinerary title" maxLength={160} value={content.title} disabled={busy} onChange={event => setContent(value => ({ ...value, title: event.target.value }))} /></label><p className="review-caption">Draft {draft.version} · Organizers only · {current ? "Not a booking" : "Earlier version — use the latest draft"}</p>
    <label className="itinerary-document-opening">Opening for the group<textarea aria-label="Opening for the group" maxLength={1500} rows={3} value={content.opening ?? ""} disabled={busy} placeholder="A short welcome and the shape of the trip" onChange={event => setContent(value => ({ ...value, opening: event.target.value }))} /></label>
    </> : null}
    <p className="review-caption" role="status">{controller?.status === "saving" ? "Saving…" : controller?.status === "saved" ? "Saved" : controller?.status === "error" ? "Save not confirmed" : controller?.status === "conflict" ? "Changed elsewhere" : "Unsaved edits"}</p>
    {controller?.status === "error" ? <><p role="alert">{controller.error}</p><button type="button" className="cm-action" disabled={busy} onClick={() => void flush().catch(() => {})}>Retry save</button></> : null}
    {controller?.status === "conflict" ? <><p role="alert">{controller.error}</p><details><summary>Compare saved version</summary><p>{controller.savedElsewhere?.draft.content.title}</p><p>{controller.savedElsewhere?.draft.content.opening}</p><ItineraryTimeline items={controller.savedElsewhere?.draft.content.items ?? []} renderDetails={item => <p>{item.participantNote}</p>} /></details><button type="button" className="cm-action" disabled={busy} onClick={() => { try { controller.reconcile(); } catch (cause) { setError(cause instanceof Error ? cause.message : "These edits conflict. Your local text is still here."); } }}>Reconcile my edits</button></> : null}
    {editing ? <><p className="review-caption">{draft.facts.startsOn} – {draft.facts.endsOn} · {draft.facts.timezone} · {draft.facts.hotels.join(", ") || "Hotel not settled"}</p>
      <fieldset disabled={busy} className="workspace-trip-fields"><legend className="sr-only">Itinerary candidates</legend>
        <ItineraryTimeline savedIds={saved} items={content.items} dayOrder={content.days?.map(day=>day.day)} onReorderDays={order=>setContent(value=>({...value,days:order.map(day=>({day,description:value.days?.find(row=>row.day===day)?.description??"",label:value.days?.find(row=>row.day===day)?.label??null}))}))}
          renderTitle={item => <input className="itinerary-inline-title" aria-label={`Title for ${item.title}${item.day ? ` on ${item.day}` : " (optional idea)"}`} maxLength={120} value={item.title} onClick={event => event.stopPropagation()} onChange={event => change(item.id, { title: event.target.value })} />}
          renderDay={day => <><label>Day description<textarea aria-label={`Description for ${day}`} maxLength={1000} rows={2} value={content.days?.find(section => section.day === day)?.description ?? ""} onChange={event => setContent(value => ({ ...value, days: value.days?.some(section=>section.day===day) ? value.days.map(section=>section.day===day?{...section,description:event.target.value}:section) : [...(value.days??[]),{day,description:event.target.value}] }))} /></label><details className="itinerary-add-stop"><summary>Add a stop</summary><label>Stop<input aria-label={`New stop for ${day}`} maxLength={120} value={dayStops[day] ?? ""} onChange={event => setDayStops(value => ({ ...value, [day]:event.target.value }))} /></label><button type="button" className="cm-action" disabled={!dayStops[day]?.trim() || content.items.length >= 30} onClick={() => { const title = dayStops[day].trim(); setContent(value => ({...value, items:[...value.items,{id:crypto.randomUUID(), title, day, time:null, kind:"activity", location:"", note:"", participantNote:"", participation:"group", alternative:false, evidence:"organizer_preference", sources:[], unresolved:[]}]})); setDayStops(value => ({...value,[day]:""})); }}>Add stop</button></details></>}
          renderDetails={item => <>
            <label>Note for the group<textarea aria-label={`Note for ${item.title}${item.day ? ` on ${item.day}` : " (optional idea)"}`} maxLength={1000} value={item.participantNote ?? ""} onChange={event => change(item.id,{participantNote:event.target.value || null})} /></label>
            {item.kind === "meal" ? <label>Restaurant (leave open for suggestions)<input maxLength={160} value={item.venue ?? ""} onChange={event => change(item.id,{venue:event.target.value || null})} /></label> : null}
            {voting(item)}
            {activityDecisionsEnabled && item.decision ? <><label>Group size for this stop<input key={`${item.id}:${item.partySize ?? ""}`} type="number" min={1} max={100} inputMode="numeric" defaultValue={item.partySize ?? ""} onBlur={event => { const value = event.target.value ? Math.max(1, Math.min(100, Math.round(Number(event.target.value)))) : null; if (value !== (item.partySize ?? null)) change(item.id, { partySize: value }); }} /></label><p className="review-caption">Checked against group rules in saved sources when you leave this field. Shared with Commons only as a number, never with names.</p>
              <ItineraryShortlistEditor item={item} evidence={draft.evidence} disabled={busy} onChange={decision => change(item.id, { decision })} results={optionResults(item)} respondents={pollResults?.responses.length} missing={missing} /></> : null}
            {item.decision && !item.decision.shortlist ? <fieldset><legend>Voting choices</legend><label>Question<input maxLength={240} value={item.decision.question} onChange={event=>change(item.id,{decision:{...item.decision!,question:event.target.value}})} /></label>{item.decision.options.map((option,index)=><label key={index}>Choice {index+1}<input maxLength={160} value={option} onChange={event=>change(item.id,{decision:{...item.decision!,options:item.decision!.options.map((value,i)=>i===index?event.target.value:value)}})} /></label>)}<button type="button" className="cm-action" onClick={()=>change(item.id,{decision:null})}>Remove choices</button></fieldset> : !item.decision && item.kind === "activity" ? <button type="button" className="cm-action" onClick={()=>change(item.id,{decision:{question:`What would you prefer for ${item.title}?`.slice(0,240),options:["Option 1","Option 2"]}})}>Add choices for this stop</button> : null}
            <details><summary>Scheduling and more details</summary><div className="itinerary-item-edit"><label>Day<input disabled={Boolean(item.travelAnchor)} type="date" min={draft.facts.startsOn ?? undefined} max={draft.facts.endsOn ?? undefined} value={item.day ?? ""} onChange={event => change(item.id, { day: event.target.value || null, ...(!event.target.value ? { time: null, endTime: null } : {}) })} /></label><label>Tentative time<TimeInput disabled={Boolean(item.travelAnchor)} aria-label="Tentative time" value={item.time ?? ""} onChange={event => change(item.id, { time: event.target.value || null, ...(!event.target.value ? { endTime: null } : {}) })} /></label><label>End time<TimeInput disabled={Boolean(item.travelAnchor)} aria-label="End time" value={item.endTime ?? ""} onChange={event => change(item.id, { endTime: event.target.value || null })} /></label></div>
              <p>{item.kind === "downtime" ? "Keep this time free" : item.participation === "optional" ? "Optional; no RSVP" : "Group suggestion; no RSVP"}</p><p>{item.note}</p>
              {item.unresolved.length ? <p className="review-caption">To check: {item.unresolved.join(" · ")}</p> : null}
              <p className="review-caption">{item.evidence.replaceAll("_", " ")}{item.sources.map(ref => { const source = draft.evidence.find(source => source.runId === ref.runId && source.sourceId === ref.sourceId); return source ? <span key={`${ref.runId}:${ref.sourceId}`}> · <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></span> : null; })}</p>
              {item.travelAnchor ? <p className="review-caption">Flight context only; check against saved travel before live approval. This row cannot create or change a flight.</p> : null}
            </details>
            <div className="workspace-actions">{([-1,1] as const).map(direction=><button key={direction} type="button" className="cm-action" disabled={!content.items.some((other,index)=>other.day===item.day && (direction<0 ? index<content.items.indexOf(item) : index>content.items.indexOf(item)))} onClick={()=>setContent(value=>{const items=[...value.items],index=items.findIndex(row=>row.id===item.id);let next=index+direction;while(next>=0 && next<items.length && items[next].day!==item.day) next+=direction;if(next>=0 && next<items.length) [items[index],items[next]]=[items[next],items[index]];return {...value,items};})}>Move stop {direction<0 ? "earlier" : "later"}</button>)}</div>
            <button type="button" className="cm-action" onClick={() => deleteItem(item.id)}>Delete draft stop</button>
          </>} />
        <details className="itinerary-add-stop"><summary>Add a stop</summary><label>Stop<input aria-label="New stop" maxLength={120} value={newTitle} onChange={event => setNewTitle(event.target.value)} /></label><details><summary>Scheduling (optional)</summary><label>Day<input type="date" min={draft.facts.startsOn ?? undefined} max={draft.facts.endsOn ?? undefined} value={newDay} onChange={event => { setNewDay(event.target.value); if (!event.target.value) setNewTime(""); }} /></label><label>Time (optional)<TimeInput aria-label="New stop time" value={newTime} disabled={!newDay} onChange={event => setNewTime(event.target.value)} /></label></details><button type="button" className="cm-action" disabled={!newTitle.trim() || content.items.length >= 30} onClick={() => { const id = crypto.randomUUID(); setContent(value => ({ ...value, items: [...value.items, { id, title: newTitle.trim(), day: newDay || null, time: newTime || null, kind: "activity", location: "", note: "", participantNote: "", participation: "group", alternative: false, evidence: "organizer_preference", sources: [], unresolved: [] }] })); setNewTitle(""); setNewTime(""); }}>Add stop</button></details>
        {activityDecisionsEnabled ? <details className="itinerary-add-stop" onToggle={event => { if ((event.currentTarget as HTMLDetailsElement).open && !trip) void loadTrip().catch(cause => setError(cause instanceof Error ? cause.message : "Plan could not load.")); }}><summary>Add a saved activity</summary>
          <p className="review-caption">Bring an activity already in Plan into this itinerary to ask the group about it. It stays the same Plan record; changes need your separate approval.</p>
          {(() => { const linked = new Set(draft.receipts.map(receipt => receipt.savedId)); const choices = (trip?.state.itinerary ?? []).filter(row => row.status !== "cancelled" && row.participantScope !== "subgroup" && !linked.has(row.id) && row.version && (!row.scheduledDate || (!draft.facts.startsOn || row.scheduledDate >= draft.facts.startsOn) && (!draft.facts.endsOn || row.scheduledDate <= draft.facts.endsOn)));
            return trip ? choices.length ? <><label>Saved activity<select value={linkId} onChange={event => setLinkId(event.target.value)}><option value="">Choose an activity</option>{choices.map(row => <option key={row.id} value={row.id}>{row.title}{row.scheduledDate ? ` · ${row.scheduledDate}` : " · No day"}</option>)}</select></label>
              <button type="button" className="cm-action" disabled={busy || !linkId || content.items.length >= 30} onClick={() => { const row = choices.find(entry => entry.id === linkId); if (!row) return; setError(""); void flush().then(() => onAction({ operation: "link_existing", planItemId: row.id, expectedRecordVersion: row.version })).then(() => setLinkId("")).catch(cause => setError(cause instanceof CoordinatorRequestError ? cause.error.userMessage : cause instanceof Error ? cause.message : "The activity was not added. Nothing changed.")); }}>Add to this itinerary</button></>
              : <p>No other saved activities fit these trip dates.</p> : <p role="status">Loading Plan…</p>; })()}
        </details> : null}
        {deleted ? <div className="workspace-actions"><span>Stop removed from this draft.</span><button type="button" className="cm-action" onClick={() => void undoDelete()}>Undo deletion</button></div> : null}
        <details><summary>Optional questions</summary>{(content.questions ?? []).map(question => <div key={question.id}><label>Question<input maxLength={240} value={question.prompt} onChange={event => setContent(value => ({ ...value, questions: (value.questions ?? []).map(row => row.id === question.id ? { ...row, prompt: event.target.value } : row) }))} /></label>{activityDecisionsEnabled ? <label><input type="checkbox" checked={question.resolved ?? false} onChange={event => setContent(value => ({ ...value, questions: (value.questions ?? []).map(row => row.id === question.id ? { ...row, resolved: event.target.checked } : row) }))} />Resolved — leave out of the next group ask</label> : null}<button type="button" className="cm-action" onClick={() => setContent(value => ({ ...value, questions: (value.questions ?? []).filter(row => row.id !== question.id) }))}>Remove question</button></div>)}{(content.questions?.length ?? 0) < 3 ? <><label>New optional question<input maxLength={240} value={questionText} onChange={event => setQuestionText(event.target.value)} /></label><button type="button" className="cm-action" disabled={!questionText.trim()} onClick={() => { setContent(value => ({ ...value, questions: [...(value.questions ?? []), { id: crypto.randomUUID(), prompt: questionText.trim() }] })); setQuestionText(""); }}>Add question</button></> : null}</details>

      </fieldset></> : null}
    <section className="itinerary-group-review" aria-label="Group itinerary review">
      <button type="button" className="cm-action cm-action--primary" disabled={busy || dirty || !participantData || Boolean(sharingDraft?.publishedPollId)} onClick={() => { setAccess("invitees"); setError(""); setConfirming(true); }}>Share with the group</button>
      {sharingDraft?.publishedPollId ? <div className="workspace-actions"><span className="review-caption">This version is published. Private edits stay private until you share them with the group.</span>{sharingPublicId ? <a className="cm-action" href={publicPollPath(sharingPublicId)}>Open published itinerary</a> : null}<button type="button" className="cm-action" onClick={()=>setShowResults(value=>!value)}>View results</button></div> : null}
      {showResults && sharingDraft?.publishedPollId ? <ItineraryFeedbackResults slug={slug} pollId={sharingDraft.publishedPollId} /> : null}
      {confirming ? <ItineraryPublishConfirmation title={content.title} access={access} onAccess={setAccess} busy={sharingBusy} error={error} changes={hasPublishedVersion} onClose={()=>setConfirming(false)} onPublish={()=>void publish()} /> : null}
      {share ? <ItineraryShareDialog data={share.data} url={share.url} title={share.data.title} access={share.access} onClose={()=>setShare(null)} /> : null}
    </section>
    {activityDecisionsEnabled && hasPublishedVersion ? <div className="workspace-actions"><button ref={planOpener} type="button" className="cm-action" disabled={busy || dirty} onClick={() => { setError(""); void flush().then(async state => { await loadTrip(); setPlanReview(structuredClone(state.draft)); }).catch(cause => setError(cause instanceof Error ? cause.message : "Save the document before reviewing additions.")); }}>Review additions to Plan</button></div> : null}
    {portability && current ? <ItineraryPortabilityPanel slug={slug} threadId={draft.threadId} document={{ id: draft.id, version: draft.version }} disabled={busy} flush={flush} seed={portability.seed}
      onApplyStart={portability.onApplyStart} onUndo={async revisionCommandId => { await onAction({ operation: "undo", revisionCommandId }); }} /> : null}
    {draft.receipts.length ? <details ref={savedReceipt} tabIndex={-1} open={Boolean(savedReview) || undefined}><summary>{draft.receipts.length} {draft.receipts.length === 1 ? "record" : "records"} in Plan{draft.receipts.some(receipt => receipt.linked) ? ` · ${draft.receipts.filter(receipt => receipt.linked).length} linked from Plan` : ""}</summary>{savedReview ? <p role="status">{{ added: "Selected activities saved to Plan.", updated: "Updates saved to the same Plan activity.", task: "Task saved with its owner. Nothing was sent." }[savedReview]} Nothing was booked.</p> : null}<ul>{draft.receipts.map(receipt => <li key={receipt.candidateId}>{draft.content.items.find(item => item.id === receipt.candidateId)?.title ?? draft.content.tasks.find(item => item.id === receipt.candidateId)?.title} · {receipt.kind === "plan" ? <a href={itemDetailPath(slug, "plan", receipt.savedId)}>Open in Plan</a> : <a href={`${commonsViewPath(slug, receipt.kind === "travel" ? "logistics" : "coordinator")}&${receipt.kind === "travel" ? "travelId" : "todo"}=${receipt.savedId}`}>Open saved {receipt.kind === "travel" ? "transport" : "task"}</a>}</li>)}</ul></details> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
