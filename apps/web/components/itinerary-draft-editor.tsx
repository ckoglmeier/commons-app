"use client";
import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { PollWorkingDraftSchema, PollWorkingDataSchema, undoStructuredDocument, itineraryContentEqual, type PollWorkingData, type PollWorkingDraft, ItineraryPollSnapshotSchema, type ItineraryPollSnapshot } from "@commons/contracts";
import { VersionedDocumentAutosave, type VersionedDocumentState } from "@/lib/itinerary-document-autosave";
import { itineraryQuestion, parseItineraryText } from "@/lib/itinerary-workshop";
import { ItineraryMessage } from "./itinerary-message";
import { ItineraryDocument } from "./itinerary-document";
type LegacyDocument = { id: string; threadId: string; version: number; content: PollWorkingData };
type State = VersionedDocumentState<PollWorkingData, LegacyDocument>;
const stateOf = (draft: PollWorkingDraft): State => ({ turnId: draft.id, draft: { id: draft.id, threadId: draft.id, version: draft.version, content: draft.data } });
export function ItineraryDraftEditor({ slug, draft, actorId, sourceImport, onSaved, onBlocked, onDirtyChange, onReady }: {
  slug: string; draft: PollWorkingDraft; actorId?: string; sourceImport?: string; onSaved: (draft: PollWorkingDraft) => void;
  onBlocked: (value: boolean) => void; onDirtyChange?: (value: boolean) => void; onReady?: (flush: (() => Promise<void>) | null) => void;
}) {
  const [controller, setController] = useState<VersionedDocumentAutosave<PollWorkingData, LegacyDocument> | null>(null), [, render] = useState(0);
  const [source, setSource] = useState(sourceImport ?? draft.data.itinerarySource ?? ""), [error, setError] = useState("");
  const [editing,setEditing]=useState(itineraryQuestion(draft.data.questions)?.itinerary.feedbackMode!=="pieces");
  const [questionText, setQuestionText] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [deleted, setDeleted] = useState<{ before: PollWorkingData; after: PollWorkingData } | null>(null);
  const savedRef = useRef(onSaved); useEffect(() => { savedRef.current = onSaved; }, [onSaved]);
  function change(snapshot: ItineraryPollSnapshot) {
    const before = data, after = { ...data, title: snapshot.title, questions: data.questions.map(row => row.id === question.id ? { ...question, itinerary: { ...snapshot, feedbackMode: question.itinerary.feedbackMode } } : row) };
    const oldIds = question.itinerary.days.flatMap(day => day.items.map(item => item.id)), newIds = snapshot.days.flatMap(day => day.items.map(item => item.id));
    if (oldIds.some(id => !newIds.includes(id))) setDeleted({ before, after });
    controller?.edit(after);
  }
  const actorKey = actorId ? `commons:${slug}:${actorId}:itinerary-document:${draft.id}` : null;
  const sourceKey = actorKey ? actorKey + ":unreviewed-source" : null;
  const legacyKey = actorId ? `commons:${slug}:${actorId}:itinerary-edit:${draft.id}:${draft.version}` : null;
  useEffect(() => {
    let mounted = true;
    const frame = requestAnimationFrame(() => {
      let raw: string | null = null;
      try { raw = actorKey ? window.sessionStorage.getItem(actorKey) : null; if (sourceImport === undefined && sourceKey) setSource(window.sessionStorage.getItem(sourceKey) ?? draft.data.itinerarySource ?? ""); } catch { /* Keep mounted input. */ }
      if (!raw && legacyKey && sourceImport === undefined) {
        try {
          const old = window.sessionStorage.getItem(legacyKey);
          const recovered = old ? z.object({ source: z.string().max(30000), reviewedSource: z.string().max(30000), itinerary: ItineraryPollSnapshotSchema, pending: z.object({ body: z.string().max(500000), commandId: z.string().uuid() }).nullable().optional() }).parse(JSON.parse(old)) : null;
          if (recovered) {
            const selected = itineraryQuestion(draft.data.questions)!;
            const content = { ...draft.data, title: recovered.itinerary.title, itinerarySource: recovered.reviewedSource, questions: draft.data.questions.map(row => row.id === selected.id ? { ...selected, itinerary: recovered.itinerary } : row) };
            let pending = null;
            if (recovered.pending) {
              const request = z.object({ id: z.literal(draft.id), expectedVersion: z.literal(draft.version), data: PollWorkingDataSchema }).parse(JSON.parse(recovered.pending.body));
              pending = { commandId: recovered.pending.commandId, documentId: draft.id, threadId: draft.id, turnId: draft.id, expectedVersion: request.expectedVersion, content: request.data };
            }
            raw = JSON.stringify({ base: stateOf(draft), content, pending });
            setSource(recovered.source);
          }
        } catch { /* Keep original notes untouched if legacy recovery cannot be verified. */ }
      }
      const editor = new VersionedDocumentAutosave<PollWorkingData, LegacyDocument>(stateOf(draft), async request => {
        const response = await fetch(`/api/v1/commons/${slug}/poll-drafts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: request.documentId, commandId: request.commandId, expectedVersion: request.expectedVersion, data: request.content }) });
        const payload = await response.json();
        if (!response.ok) {
          if (response.status === 409) {
            const latestResponse = await fetch(`/api/v1/commons/${slug}/poll-drafts`, { cache: "no-store" });
            if (latestResponse.ok) { const latest = PollWorkingDraftSchema.array().parse((await latestResponse.json()).drafts).find(row => row.id === request.documentId); if (latest) editor.receive(stateOf(latest)); }
          }
          throw new Error(payload.error ?? "The save was not confirmed. Your text is still here.");
        }
        const saved = PollWorkingDraftSchema.parse(payload.draft);
        if (saved.id !== request.documentId || saved.version !== request.expectedVersion + 1 || !itineraryContentEqual(saved.data, request.content)) throw new Error("The saved text could not be verified. Your edits are still here.");
        const current = payload.currentDraft ? PollWorkingDraftSchema.parse(payload.currentDraft) : saved;
        if (current.id !== saved.id) throw new Error("The document receipt could not be verified.");
        if (saved.id === request.documentId && saved.version === request.expectedVersion + 1) { try { if (legacyKey) window.sessionStorage.removeItem(legacyKey); } catch { /* Optional recovery cleanup. */ } }
        if (mounted) savedRef.current(current);
        return { ...stateOf(saved), observed: stateOf(current) };
      }, () => { if (mounted) render(value => value + 1); }, value => {
        try { if (actorKey) { if (value) window.sessionStorage.setItem(actorKey, value); else window.sessionStorage.removeItem(actorKey); } } catch { /* Mounted text remains available. */ }
      }, raw, { content: value => PollWorkingDataSchema.parse(value), draft: value => { const row = value as LegacyDocument; return { id: PollWorkingDraftSchema.shape.id.parse(row.id), threadId: PollWorkingDraftSchema.shape.id.parse(row.threadId), version: PollWorkingDraftSchema.shape.version.parse(row.version), content: PollWorkingDataSchema.parse(row.content) }; }, undo: (value, before, after) => PollWorkingDataSchema.parse(undoStructuredDocument(value, before, after)) });
      if (sourceImport !== undefined) {
        try { const current = editor.content, question = itineraryQuestion(current.questions)!; const snapshot = parseItineraryText(sourceImport, question.itinerary.title); editor.edit({ ...current, title: snapshot.title, itinerarySource: sourceImport, questions: current.questions.map(row => row.id === question.id ? { ...question, itinerary: { ...snapshot, feedbackMode: question.itinerary.feedbackMode } } : row) }); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Review the pasted itinerary."); }
      }
      setController(editor); setHydrated(true);
    });
    return () => { mounted = false; cancelAnimationFrame(frame); };
    // Keep the controller mounted across saved versions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorKey, draft.id, sourceImport]);
  useEffect(() => { controller?.receive(stateOf(draft)); }, [controller, draft]);
  const data = controller?.content ?? draft.data, question = itineraryQuestion(data.questions)!;
  const needsImportReview = source !== (data.itinerarySource ?? ""), dirty = controller?.dirty ?? false;
  useEffect(() => { onBlocked(needsImportReview); return () => onBlocked(false); }, [needsImportReview, onBlocked]);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { try { if (sourceKey && hydrated) window.sessionStorage.setItem(sourceKey, source); } catch { /* Keep input. */ } }, [sourceKey, source, hydrated]);
  const flush = async () => { if (!controller || needsImportReview) throw new Error("Review your pasted notes before sending. Your message is still here."); await controller.flush(); };
  useEffect(() => { onReady?.(controller ? flush : null); return () => onReady?.(null); }, [controller, needsImportReview, onReady]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!controller || controller.status !== "dirty" || needsImportReview) return;
    const timer = setTimeout(() => { void controller.flush().catch(() => {}); }, 650); return () => clearTimeout(timer);
  }, [controller, data, controller?.status, needsImportReview]);
  const act = (run: () => void | Promise<void>) => { setError(""); void Promise.resolve().then(run).catch(cause => setError(cause instanceof Error ? cause.message : "The save was not confirmed. Your edits are still here.")); };
  return <section aria-label="Itinerary draft">
    <p className="review-caption">Private document · Nothing shared by editing</p>
    <button type="button" className="cm-action" aria-expanded={editing} onClick={()=>setEditing(value=>!value)}>{editing ? "Done editing" : "Edit"}</button>
    {!editing ? <ItineraryMessage data={data} allowLegacy disabled={!controller} onTitleChange={title=>change({...question.itinerary,title})} onOpeningChange={opening=>controller?.edit({...data,intro:opening.length<=500?opening:null,communication:opening.trim()?{heading:data.communication?.heading??data.title,paragraphs:[opening],links:data.communication?.links??[]}:undefined})} onItineraryChange={change} /> : null}
    {editing ? <label>Opening for the group<textarea maxLength={1500} rows={3} value={data.communication?.paragraphs.join("\n\n") ?? data.intro ?? ""} onChange={event => { const opening = event.target.value; controller?.edit({ ...data, intro: opening.length <= 500 ? opening : null, communication: opening.trim() ? { heading: data.communication?.heading ?? data.title, paragraphs: [opening], links: data.communication?.links ?? [] } : undefined }); }} /></label> : null}
    <p className="review-caption" role="status">{!controller ? "Loading document…" : controller.status === "saving" ? "Saving…" : controller.status === "saved" ? "Saved" : controller.status === "conflict" ? "Changed elsewhere" : controller.status === "error" ? "Save not confirmed" : "Unsaved edits"}</p>
    {controller?.status === "error" ? <><p role="alert">{controller.error}</p><button type="button" className="cm-action" onClick={() => act(flush)}>Retry save</button></> : null}
    {controller?.status === "conflict" ? <><p role="alert">{controller.error}</p><details><summary>Compare saved version</summary><ItineraryDocument itinerary={itineraryQuestion(controller.savedElsewhere?.draft.content.questions ?? [])?.itinerary ?? question.itinerary} /></details><button type="button" className="cm-action" onClick={() => act(() => controller.reconcile())}>Reconcile my edits</button></> : null}
    <details className="itinerary-import" open={!question.itinerary.days.some(day => day.items.length)}><summary>Paste an itinerary</summary><label>Paste your itinerary<textarea rows={6} value={source} maxLength={30000} onPaste={event => { if (event.clipboardData.getData("text/plain").length + source.length - (event.currentTarget.selectionEnd - event.currentTarget.selectionStart) > 30000) { event.preventDefault(); setError("Use up to 30,000 characters. Nothing was truncated."); } }} onChange={event => setSource(event.target.value)} /></label><button type="button" className="cm-action" disabled={!controller || !source.trim()} onClick={() => act(() => { const snapshot = parseItineraryText(source, question.itinerary.title); controller!.edit({ ...data, title: snapshot.title, itinerarySource: source, questions: data.questions.map(row => row.id === question.id ? { ...question, itinerary: { ...snapshot, feedbackMode: question.itinerary.feedbackMode } } : row) }); })}>Review pasted itinerary</button></details>
    {needsImportReview ? <p role="status" className="review-caption">Review the pasted notes before they replace this document.</p> : null}
    {editing ? <ItineraryDocument itinerary={question.itinerary} onChange={change} disabled={!controller} /> : null}
    {deleted ? <div className="workspace-actions"><span>Stop removed from this draft.</span><button type="button" className="cm-action" onClick={() => act(() => { controller!.edit(PollWorkingDataSchema.parse(undoStructuredDocument(controller!.content, deleted.before, deleted.after))); setDeleted(null); })}>Undo deletion</button></div> : null}
    {editing ? <details><summary>Optional questions</summary>{data.questions.filter(row => row.kind === "text").map(row => <div key={row.id}><label>Question<input maxLength={240} value={row.prompt} onChange={event => controller?.edit({ ...data, questions: data.questions.map(item => item.id === row.id ? { ...item, prompt: event.target.value } : item) })} /></label><button type="button" className="cm-action" onClick={() => controller?.edit({ ...data, questions: data.questions.filter(item => item.id !== row.id) })}>Remove question</button></div>)}{data.questions.filter(row => row.kind === "text").length < 3 ? <><label>New optional question<input maxLength={240} value={questionText} onChange={event => setQuestionText(event.target.value)} /></label><button type="button" className="cm-action" disabled={!questionText.trim()} onClick={() => { controller?.edit({ ...data, questions: [...data.questions, { id: crypto.randomUUID(), kind: "text", required: false, prompt: questionText.trim() }] }); setQuestionText(""); }}>Add question</button></> : null}</details> : null}

    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
