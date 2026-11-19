"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { TurnCommand } from "@commons/contracts";
type Source = { id: string; filename: string; digest?: string; text?: string; limitations?: string[]; status: "processing" | "ready" | "error"; error?: string };
export function CoordinatorSourceAttachments({ slug, actorId, destination, disabled, clearIds, onChange, pickerRef, returnFocusRef, hideAttachButton=false }: {
  pickerRef?: RefObject<(()=>void)|null>; returnFocusRef?: RefObject<HTMLButtonElement|null>; hideAttachButton?: boolean;
  slug: string; actorId?: string; destination: string; disabled: boolean; clearIds?: string[];
  onChange: (refs: NonNullable<TurnCommand["attachments"]>, blocked: boolean) => void;
}) {
  const [items, setItems] = useState<Source[]>([]), [restored, setRestored] = useState(false), [legacy, setLegacy] = useState("");
  const [error, setError] = useState(""), [legacyDismissed, setLegacyDismissed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), attachButton = useRef<HTMLButtonElement>(null);
  const alive = useRef(true), pending = useRef(new Map<string, AbortController>()), removed = useRef(new Set<string>());
  const reserved = useRef(new Set<string>());
  const endpoint = "/api/v1/commons/" + slug + "/coordinator/sources";
  const key = actorId ? "commons:" + slug + ":" + actorId + ":sources:" + destination : null;
  const legacyKey = actorId ? "commons:" + slug + ":" + actorId + ":itinerary-intake:" + destination : null;
  useEffect(() => {
    alive.current = true;
    const frame = requestAnimationFrame(() => {
      try {
        const stored = key ? JSON.parse(window.sessionStorage.getItem(key) ?? "[]") : [];
        const records: Source[] = Array.isArray(stored) ? stored.filter(row => typeof row.id === "string" && typeof row.filename === "string").slice(0,3) : [];
        reserved.current = new Set(records.map(row => row.id));
        setItems(records.map(row => ({ ...row, status: row.digest ? "processing" : "error", error: "This local file could not be restored. Reattach it before sending." })));
        for (const row of records) if (row.digest) {
          const controller = new AbortController(); pending.current.set(row.id, controller);
          void fetch(endpoint + "?id=" + row.id + "&digest=" + row.digest + "&scope=" + encodeURIComponent(destination), { cache: "no-store", signal: controller.signal }).then(async response => {
            const body = await response.json(); if (!response.ok) throw new Error("This source expired or is unavailable. Reattach the file.");
            if (alive.current && !removed.current.has(row.id)) setItems(value => value.map(item => item.id === row.id ? { ...body.source, status: "ready" } : item));
          }).catch(() => { if (alive.current && !removed.current.has(row.id)) setItems(value => value.map(item => item.id === row.id ? { ...item, status: "error", error: "This source is unavailable. Reattach the file." } : item)); }).finally(() => pending.current.delete(row.id));
        }
        const old = legacyKey ? window.sessionStorage.getItem(legacyKey) : null;
        if (old) { setLegacy(old); setLegacyDismissed(window.sessionStorage.getItem(legacyKey + ":dismissed") === "1"); }
      } catch { setError("Saved attachments could not be restored. Reattach them; your message is unchanged."); }
      setRestored(true);
    });
    const requests = pending.current;
    return () => { alive.current = false; cancelAnimationFrame(frame); requests.forEach(controller => controller.abort()); };
  }, [destination, endpoint, key, legacyKey]);
  useEffect(() => {
    onChange(items.filter(item => item.status === "ready" && item.digest).map(item => ({ id: item.id, digest: item.digest! })), !restored || items.some(item => item.status !== "ready"));
    if (!key || !restored) return;
    try { window.sessionStorage.setItem(key, JSON.stringify(items.map(({ id, filename, digest, status }) => ({ id, filename, digest, status })))); } catch { /* Mounted references remain usable. */ }
  }, [items, key, onChange, restored]);
  useEffect(() => {
    if (clearIds?.length) { const frame = requestAnimationFrame(() => { clearIds.forEach(id => reserved.current.delete(id)); setItems(value => value.filter(item => !clearIds.includes(item.id))); }); return () => cancelAnimationFrame(frame); }
  }, [clearIds]);
  async function upload(file: File, recovered = false) {
    if (disabled || !restored || !actorId || reserved.current.size >= 3) { setError("Attach up to three sources per message."); return; }
    const id = crypto.randomUUID(), controller = new AbortController();
    reserved.current.add(id);
    pending.current.set(id, controller); setError("");
    setItems(value => [...value, { id, filename: file.name, status: "processing" }]);
    const body = new FormData(); body.set("id", id); body.set("file", file);
    try {
      const response = await fetch(endpoint + "?scope=" + encodeURIComponent(destination), { method: "POST", body, signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The file could not be read.");
      if (!alive.current || removed.current.has(id)) return;
      setItems(value => value.map(item => item.id === id ? { ...result.source, status: "ready" } : item));
      if (recovered) dismissLegacy();
    } catch (cause) {
      if (alive.current && !removed.current.has(id)) setItems(value => value.map(item => item.id === id ? { ...item, status: "error", error: cause instanceof Error ? cause.message : "Reattach this file." } : item));
    } finally { pending.current.delete(id); }
  }
  useEffect(()=>{
    if(!pickerRef)return;
    pickerRef.current=()=>{if(disabled || !restored || !actorId)return;if(reserved.current.size>=3){setError("Attach up to three sources per message.");return;}fileInput.current?.click();};
    return ()=>{pickerRef.current=null;};
  },[pickerRef,disabled,restored,actorId]);
  function remove(item: Source) {
    reserved.current.delete(item.id);
    removed.current.add(item.id); pending.current.get(item.id)?.abort();
    setItems(value => value.filter(row => row.id !== item.id));
    // Cancel by the allocated ID even before extraction returns a digest.
    void fetch(endpoint + "?id=" + item.id, { method: "DELETE" }).catch(() => {});
    requestAnimationFrame(() => (returnFocusRef?.current ?? attachButton.current)?.focus());
  }
  function dismissLegacy() {
    setLegacyDismissed(true);
    try { if (legacyKey) window.sessionStorage.setItem(legacyKey + ":dismissed", "1"); } catch { /* Original notes remain untouched. */ }
  }
  return <div className="workspace-source-attachments" role="region" aria-label="Attached sources">
    <button hidden={hideAttachButton} ref={attachButton} type="button" className="cm-action workspace-attach" disabled={disabled || !restored || items.length >= 3 || !actorId} onClick={() => fileInput.current?.click()}>Attach file</button>
    <input ref={fileInput} type="file" hidden tabIndex={-1} aria-label="Attach Markdown or Excel source" accept=".md,.markdown,.txt,.xlsx" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
    {items.map(item => <div key={item.id} className="workspace-source-chip">
      <details><summary><span className="workspace-source-filename">{item.filename}</span><span role="status">{item.status === "processing" ? "Processing…" : item.status === "ready" ? "Ready" : "Could not read"}</span></summary>
        {item.status === "ready" ? <div className="workspace-source-preview"><p style={{ whiteSpace: "pre-wrap" }}>{item.text}</p>{item.limitations?.map(value => <p className="review-caption" key={value}>{value}</p>)}</div> : null}
        {item.error && item.status === "error" ? <p role="alert">{item.error}</p> : null}
      </details>
      <button type="button" className="cm-action" aria-label={`Remove ${item.filename}`} disabled={disabled} onClick={() => remove(item)}>×</button>
    </div>)}
    {legacy ? <div className="workspace-legacy-recovery">{!legacyDismissed ? <><span>Unsent notes available</span><button type="button" className="cm-action" aria-label="Dismiss recovered notes prompt" onClick={dismissLegacy}>Dismiss</button></> : null}<details><summary>Recover unsent notes</summary><p style={{ whiteSpace: "pre-wrap" }}>{legacy}</p><button type="button" className="cm-action" disabled={disabled || items.length >= 3} onClick={() => void upload(new File([legacy], "Recovered notes.txt", { type: "text/plain" }), true)}>Attach recovered notes</button></details></div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
