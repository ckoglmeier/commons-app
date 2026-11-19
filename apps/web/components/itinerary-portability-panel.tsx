"use client";
import { useEffect, useRef, useState } from "react";
import { ITINERARY_IMPORT_TEXT_LIMIT, ItineraryImportPreviewSchema, ItineraryImportReceiptSchema, type ItineraryImportPreview, type ItineraryImportReceipt } from "@commons/contracts";

type Props = {
  slug: string; threadId: string;
  /** The saved document to export and compare with; null starts a new private itinerary. */
  document: { id: string; version: number } | null;
  disabled?: boolean;
  /** Saves pending direct edits first, so export and review use the saved version. */
  flush?: () => Promise<unknown>;
  seed?: { text: string; token: string } | null;
  /** Capture presentation permission when Save is clicked, before the network request. */
  onApplyStart: () => (receipt: ItineraryImportReceipt) => Promise<void>;
  onUndo?: (revisionCommandId: string) => Promise<void>;
};
const kindLabel = { add: "Add", edit: "Change", remove: "Remove" } as const;

async function readError(response: Response, fallback: string) {
  try { const body = await response.json() as { error?: string }; return body.error || fallback; } catch { return fallback; }
}

/** Export and reviewed re-import for one itinerary. Review saves nothing; only "Save selected changes" writes, through the existing versioned command. */
export function ItineraryPortabilityPanel({ slug, threadId, document, disabled = false, flush, seed, onApplyStart, onUndo }: Props) {
  const base = `/api/v1/commons/${encodeURIComponent(slug)}/coordinator`;
  const [open, setOpen] = useState(Boolean(seed) || !document);
  const [text, setText] = useState(seed?.text ?? "");
  const [preview, setPreview] = useState<ItineraryImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [receipt, setReceipt] = useState<ItineraryImportReceipt | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [copied, setCopied] = useState<string | null>(null), [manualCopy, setManualCopy] = useState<string | null>(null);
  const attempt = useRef<{ key: string; commandId: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null), reviewHeading = useRef<HTMLHeadingElement>(null), receiptRef = useRef<HTMLParagraphElement>(null);
  const seedToken = seed?.token;
  useEffect(() => {
    if (!seed) return;
    // A returned file pasted into the composer opens here for review; the composer text is left as it was.
    // A returned file is reviewed straight away; reviewing saves nothing.
    const frame = requestAnimationFrame(() => { setOpen(true); if (seed.text) { setText(seed.text); setReceipt(null); void review(JSON.stringify({ threadId, text: seed.text }), true); } });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new seed token is the trigger.
  }, [seedToken]);
  const locked = disabled || busy;

  async function exported() {
    await flush?.();
    if (!document) throw new Error("There’s no itinerary to export yet.");
    const response = await fetch(`${base}/itinerary-export?threadId=${encodeURIComponent(threadId)}&documentId=${encodeURIComponent(document.id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await readError(response, "The export wasn’t created. Your itinerary is unchanged; try again."));
    const filename = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1];
    return { markdown: await response.text(), version: response.headers.get("x-commons-itinerary-version"), filename };
  }
  async function download() {
    setBusy(true); setError(""); setCopied(null);
    try {
      await flush?.();
      const response = await fetch(`${base}/itinerary-export?threadId=${encodeURIComponent(threadId)}&documentId=${encodeURIComponent(document!.id)}&download=1`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "The export wasn’t created. Your itinerary is unchanged; try again."));
      const filename = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "itinerary.md";
      const url = URL.createObjectURL(new Blob([await response.text()], { type: "text/markdown" })), link = window.document.createElement("a");
      link.href = url; link.download = filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setCopied(`Downloaded ${filename}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The export wasn’t created. Try again."); }
    finally { setBusy(false); }
  }
  async function copy() {
    setBusy(true); setError(""); setCopied(null); setManualCopy(null);
    try {
      const result = await exported();
      try { await navigator.clipboard.writeText(result.markdown); setCopied(`Copied version ${result.version ?? document?.version} as Markdown.`); }
      catch { setManualCopy(result.markdown); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The export wasn’t created. Try again."); }
    finally { setBusy(false); }
  }
  function show(next: ItineraryImportPreview) {
    setPreview(next); setReceipt(null);
    setSelected(new Set(next.changes.filter(change => change.selected && change.selectable).map(change => change.id)));
    requestAnimationFrame(() => reviewHeading.current?.focus());
  }
  async function review(body: BodyInit, json: boolean) {
    setBusy(true); setError(""); setPreview(null); setReceipt(null);
    try {
      await flush?.();
      const response = await fetch(`${base}/itinerary-import`, { method: "POST", body, ...(json ? { headers: { "Content-Type": "application/json" } } : {}) });
      if (!response.ok) throw new Error(await readError(response, "The file couldn’t be reviewed. Nothing was changed."));
      const payload = await response.json() as { preview: unknown; text?: string };
      if (typeof payload.text === "string") setText(payload.text);
      show(ItineraryImportPreviewSchema.parse(payload.preview));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The file couldn’t be reviewed. Nothing was changed."); }
    finally { setBusy(false); }
  }
  function reviewText() {
    if (!text.trim()) { setError("Paste the itinerary text or choose a file first."); return; }
    void review(JSON.stringify({ threadId, text }), true);
  }
  function reviewFile(file: File | undefined) {
    if (!file) return;
    const form = new FormData(); form.set("threadId", threadId); form.set("file", file);
    void review(form, false);
    if (fileInput.current) fileInput.current.value = "";
  }
  async function apply() {
    if (!preview || !selected.size) return;
    const onApplied = onApplyStart();
    const chosen = [...selected].sort(), key = JSON.stringify([text, chosen, preview.currentVersion]);
    // The same review and choice reuse one command, so a retry after a lost response never saves twice.
    if (attempt.current?.key !== key) attempt.current = { key, commandId: crypto.randomUUID() };
    setBusy(true); setError("");
    try {
      const response = await fetch(`${base}/itinerary-import/apply`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, text, selected: chosen, expectedVersion: preview.currentVersion, commandId: attempt.current.commandId }) });
      if (!response.ok) throw new Error(await readError(response, "The import wasn’t confirmed. Review it again before retrying; nothing was changed."));
      const saved = ItineraryImportReceiptSchema.parse((await response.json() as { receipt: unknown }).receipt);
      setReceipt(saved); setPreview(null); attempt.current = null;
      requestAnimationFrame(() => receiptRef.current?.focus());
      try { await onApplied(saved); } catch { setError("The import is saved. Refresh the conversation to see the updated itinerary."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The import wasn’t confirmed. Review it again; nothing was changed."); }
    finally { setBusy(false); }
  }
  async function undo() {
    if (!receipt?.revisionCommandId || !onUndo) return;
    setBusy(true); setError("");
    try { await onUndo(receipt.revisionCommandId); setReceipt(null); setCopied("Import undone. The earlier version is back."); }
    catch { setError("Undo wasn’t saved, usually because the itinerary changed again. Your current itinerary is unchanged."); }
    finally { setBusy(false); }
  }
  const selectable = preview?.changes.filter(change => change.selectable) ?? [];
  const toggle = (id: string, on: boolean) => setSelected(value => { const next = new Set(value); if (on) next.add(id); else next.delete(id); return next; });

  return <details className="itinerary-portability workspace-work-section" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{document ? "Export or bring back changes" : "Import an itinerary"}</summary>
    {document ? <section aria-label="Export itinerary">
      <p className="review-caption">Take this itinerary to another app or assistant as Markdown. Private notes, sources, tasks and costs aren’t included.</p>
      <div className="workspace-actions"><button type="button" className="cm-action" disabled={locked} onClick={() => void download()}>Download Markdown</button><button type="button" className="cm-action" disabled={locked} onClick={() => void copy()}>Copy Markdown</button></div>
      {manualCopy ? <label className="itinerary-portability__text">Copying isn’t allowed here. Select this text and copy it.<textarea readOnly rows={6} value={manualCopy} onFocus={event => event.currentTarget.select()} /></label> : null}
    </section> : null}
    <section aria-label={document ? "Bring back changes" : "Import an itinerary"}>
      <h4>{document ? "Bring back changes" : "Start from a Markdown itinerary"}</h4>
      <p className="review-caption">{document ? "Paste or choose the edited file. You’ll review each change before anything is saved. Stops missing from the file stay." : "Paste or choose a Markdown or text itinerary. You’ll review it before a private draft is saved. Nothing is shared."}</p>
      <label className="itinerary-portability__text">Itinerary text<textarea rows={6} maxLength={ITINERARY_IMPORT_TEXT_LIMIT} value={text} disabled={locked}
        onPaste={event => { const incoming = event.clipboardData.getData("text/plain").length, selection = event.currentTarget.selectionEnd - event.currentTarget.selectionStart; if (incoming + text.length - selection > ITINERARY_IMPORT_TEXT_LIMIT) { event.preventDefault(); setError("Use up to 30,000 characters. Nothing was truncated."); } }}
        onChange={event => { setText(event.target.value); setPreview(null); }} /></label>
      <div className="workspace-actions">
        <button type="button" className="cm-action cm-action--primary" disabled={locked || !text.trim()} onClick={reviewText}>Review changes</button>
        <label className="cm-action itinerary-portability__file">Choose a file<input ref={fileInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" disabled={locked} onChange={event => reviewFile(event.target.files?.[0])} /></label>
      </div>
    </section>
    {preview ? <section className="itinerary-import-review" aria-labelledby={`import-review-${threadId}`}>
      <h4 id={`import-review-${threadId}`} ref={reviewHeading} tabIndex={-1}>{preview.mode === "rejected" ? "This file can’t be applied" : preview.mode === "create" ? `New private itinerary · ${preview.changes.length} ${preview.changes.length === 1 ? "part" : "parts"}` : `${preview.changes.length} ${preview.changes.length === 1 ? "change" : "changes"} to review`}</h4>
      {preview.message ? <p className={preview.mode === "rejected" || preview.stale ? "itinerary-import-review__notice" : "review-caption"} role={preview.mode === "rejected" ? "alert" : undefined}>{preview.message}</p> : null}
      {preview.changes.length ? <fieldset disabled={locked}><legend className="sr-only">Choose changes to save</legend><ul className="itinerary-import-changes">
        {preview.changes.map(change => <li key={change.id} data-kind={change.kind} data-blocked={!change.selectable || undefined}>
          <label><input type="checkbox" checked={selected.has(change.id)} disabled={!change.selectable} onChange={event => toggle(change.id, event.target.checked)} />
            <span><strong>{kindLabel[change.kind]}</strong> · {change.label}</span></label>
          {change.before && change.kind !== "add" ? <p className="itinerary-import-changes__before"><span className="sr-only">Now: </span>{change.before}</p> : null}
          {change.after ? <p className="itinerary-import-changes__after"><span className="sr-only">From the file: </span>{change.after}</p> : null}
          {change.note ? <p className="review-caption">{change.selectable ? change.note : `Not applied. ${change.note}`}</p> : null}
        </li>)}
      </ul></fieldset> : null}
      {preview.kept.length ? <details><summary>{preview.kept.length} {preview.kept.length === 1 ? "stop isn’t" : "stops aren’t"} in the file and will stay</summary><ul>{preview.kept.map((title, index) => <li key={`${index}:${title}`}>{title}</li>)}</ul></details> : null}
      {preview.unrecognized.length ? <details open><summary>{preview.unrecognized.length} {preview.unrecognized.length === 1 ? "line needs" : "lines need"} a look</summary><ul>{preview.unrecognized.map((line, index) => <li key={`${index}:${line}`}>{line}</li>)}</ul><p className="review-caption">These weren’t applied. Your file still has them.</p></details> : null}
      <div className="workspace-actions">
        {preview.mode !== "rejected" && selectable.length ? <button type="button" className="cm-action cm-action--primary" disabled={locked || !selected.size} onClick={() => void apply()}>{preview.mode === "create" ? "Save private itinerary" : `Save ${selected.size} selected ${selected.size === 1 ? "change" : "changes"}`}</button> : null}
        <button type="button" className="cm-action" disabled={busy} onClick={() => { setPreview(null); setError(""); }}>Cancel</button>
      </div>
      {preview.mode !== "rejected" ? <p className="review-caption">Saving changes only this private itinerary. It doesn’t share, publish, add to Plan or book anything.</p> : null}
    </section> : null}
    {receipt ? <div className="workspace-actions itinerary-import-receipt"><p ref={receiptRef} tabIndex={-1} role="status">{receipt.replayed ? "Already saved" : "Saved"} as version {receipt.version} · {receipt.applied} {receipt.applied === 1 ? "change" : "changes"} from the file.</p>
      {receipt.revisionCommandId && onUndo ? <button type="button" className="cm-action" disabled={locked} onClick={() => void undo()}>Undo import</button> : null}</div> : null}
    {copied ? <p className="review-caption" role="status">{copied}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
