"use client";

import { useEffect, useRef, useState } from "react";
import { EditIcon, ShareIcon } from "./icons";
import { TRIP_LETTER_SECTION_IDS, type TripLetterSections } from "@commons/contracts";
import { DEFAULT_LETTER_SECTIONS, moveLetterSection, tripLetterSectionLabel } from "@/lib/trip-letter";

async function saveLetter(slug: string, body: object) {
  const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/letter`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "Not saved. Try again.");
}

/** The organizer's own words. A failed save keeps the text, and a retry reuses the same command. */
export function TripLetterWelcome({ slug, welcome, authorName, canEdit, onSaved, emptyText, hint }: {
  /** The free stage's words: there the welcome is read at the top of a poll, not on this page. */
  emptyText?: string; hint?: string;
  slug: string; welcome: string | null; authorName: string | null; canEdit: boolean; onSaved: (text: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(welcome ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const command = useRef<{ text: string; id: string } | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);

  async function save() {
    if (busy) return;
    const next = text.trim();
    if (command.current?.text !== next) command.current = { text: next, id: crypto.randomUUID() };
    setBusy(true); setError("");
    try {
      await saveLetter(slug, { commandId: command.current.id, welcome: { text: next, expected: welcome } });
      command.current = null;
      onSaved(next || null);
      setEditing(false); setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved. Try again.");
    } finally { setBusy(false); }
  }

  if (editing) return <form className="trip-letter__welcome-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <label className="field"><span>Welcome</span><textarea ref={field} value={text} maxLength={700} rows={5} onChange={event => setText(event.target.value)} /></label>
    <p className="trip-letter__quiet">{hint ?? "Your group reads this first."}</p>
    {error ? <p className="cm-note" role="alert">{error}</p> : null}
    <div className="setup-actions"><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setEditing(false); setText(welcome ?? ""); setError(""); }}>Cancel</button></div>
  </form>;
  if (!welcome && !canEdit) return null;
  return <div className="trip-letter__welcome">
    {welcome ? <><p className="trip-letter__lead">{welcome}</p>{authorName ? <p className="trip-letter__sign">{authorName}, organizing</p> : null}</>
      : <p className="trip-letter__lead trip-letter__lead--empty">{emptyText ?? "Your group reads this page first. Start with a line or two about the trip."}</p>}
    {canEdit ? <button ref={opener} className="text-action" type="button" onClick={() => { setSaved(false); setEditing(true); }}>{welcome ? "Edit welcome" : "Write a welcome"}</button> : null}
    {saved ? <p className="trip-letter__quiet" role="status">Saved.</p> : null}
  </div>;
}

/** Preview before sharing. Copying never claims delivery; sending from Commons arrives with the qualified messaging channel. */
export function TripLetterShareUpdate({ slug, canText, canWrite = false, text, recipients, tripEnded }: { slug: string; canText: boolean; canWrite?: boolean; text: string; recipients: readonly string[]; tripEnded: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [own, setOwn] = useState(""), shareId = useRef<string | null>(null);
  /** The organizer's own words, posted by Commons into the thread of each traveler with messages on. A retry keeps its id, so it can't go twice. */
  async function shareOwn() {
    const body = own.trim();
    if (!body) return;
    setSending(true); setStatus("");
    shareId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/messaging/web`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ share: { id: shareId.current, body } }) });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error?.message ?? "Not sent. Try again.");
      setStatus(value.recipients ? `On its way to ${value.recipients === 1 ? "1 traveler" : `${value.recipients} travelers`} with messages on. If it’s quiet hours for the trip, Commons holds it until morning.` : "Nobody has messages on for this trip yet, so nothing was sent.");
      setOwn(""); shareId.current = null;
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "Not sent. Try again."); }
    finally { setSending(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setStatus("Copied. Nothing has been sent."); }
    catch { setStatus("Couldn’t copy. Select the text above instead."); }
  }
  async function textIt(kind: "update" | "settlement") {
    setSending(true); setStatus("");
    try {
      const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/letter/text/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : value.error?.message ?? "Not queued. Try again.");
      setStatus(canWrite
        ? value.queued ? `On its way to ${value.queued === 1 ? "1 traveler" : `${value.queued} travelers`} with messages on. If it’s quiet hours for the trip, Commons holds it until morning.` : "Nobody new to send to. Only travelers with messages on get these."
        : value.queued ? `Queued for ${value.queued}. Queued isn’t delivered. Commons sends these outside quiet hours.` : "Nobody new to text. Only people who opted in get these.");
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "Not queued. Try again."); }
    finally { setSending(false); }
  }
  return <>
    <button ref={opener} className="home-action" type="button" onClick={() => { setStatus(""); dialog.current?.showModal(); }}><ShareIcon /><span>Share an update</span></button>
    <dialog ref={dialog} className="trip-letter__arrange" aria-labelledby="trip-letter-update-title" onClose={() => opener.current?.focus()}>
      <header><h2 id="trip-letter-update-title">Share an update</h2><button className="text-action" type="button" onClick={() => dialog.current?.close()}>Close</button></header>
      <pre className="trip-letter__update-text">{text}</pre>
      <p className="trip-letter__quiet">{recipients.length ? `For ${recipients.join(", ")}.` : "Nobody else is on this trip yet."} The link only opens for people on the trip.</p>
      <div className="setup-actions"><button type="button" onClick={() => void copy()}>Copy update</button>{canText ? <button type="button" className="secondary" disabled={sending} onClick={() => void textIt("update")}>{canWrite ? "Send this update" : "Text travelers who opted in"}</button> : <button type="button" className="secondary" onClick={() => dialog.current?.close()}>Close</button>}{canText && tripEnded ? <button type="button" className="secondary" disabled={sending} onClick={() => void textIt("settlement")}>{canWrite ? "Send balance reminders" : "Text balance reminders"}</button> : null}</div>
      {canWrite ? <form className="trip-letter__own" onSubmit={event => { event.preventDefault(); void shareOwn(); }}>
        <label className="field"><span>Or write your own</span>
          <textarea rows={3} maxLength={480} value={own} onChange={event => { setOwn(event.target.value); shareId.current = null; }} /></label>
        <p className="trip-letter__quiet">Commons posts it in the Messages of each traveler who turned them on, with your name. Replies go to Commons, not to you. Up to 3 a day.</p>
        <div className="setup-actions"><button type="submit" className="secondary" disabled={sending || !own.trim()}>Send your message</button></div>
      </form> : null}
      <p className="trip-letter__quiet" role="status">{status}</p>
    </dialog>
  </>;
}

/** Arranging trusted sections changes presentation only. Nothing is shown to the group until Save for everyone. */
export function TripLetterArrange({ slug, sections, onSaved }: {
  slug: string; sections: TripLetterSections | null; onSaved: (next: TripLetterSections | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<TripLetterSections>(sections ?? DEFAULT_LETTER_SECTIONS);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  function open() { setDraft(sections ?? DEFAULT_LETTER_SECTIONS); setPreviewing(false); setError(""); setStatus(""); dialog.current?.showModal(); }
  function close() { dialog.current?.close(); opener.current?.focus(); }
  async function save() {
    if (busy) return;
    setBusy(true); setError("");
    const isDefault = JSON.stringify(draft) === JSON.stringify(DEFAULT_LETTER_SECTIONS);
    const value = isDefault ? null : draft;
    try {
      await saveLetter(slug, { commandId: crypto.randomUUID(), sections: { value, expected: sections } });
      onSaved(value); close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Not saved. Try again."); }
    finally { setBusy(false); }
  }
  const hidden = draft.filter(section => section.hidden).map(section => tripLetterSectionLabel(section.id));

  return <>
    <button ref={opener} className="home-action" type="button" onClick={open}><EditIcon /><span>Arrange this page</span></button>
    <dialog ref={dialog} className="trip-letter__arrange" aria-labelledby="trip-letter-arrange-title" onClose={() => opener.current?.focus()}>
      <header><h2 id="trip-letter-arrange-title">{previewing ? "What your group will see" : "Arrange this page"}</h2><button className="text-action" type="button" onClick={close}>Close</button></header>
      {previewing ? <>
        <ol className="trip-letter__arrange-preview">{draft.filter(section => !section.hidden).map(section => <li key={section.id}>{tripLetterSectionLabel(section.id)}</li>)}</ol>
        {hidden.length ? <p className="trip-letter__quiet">Hidden: {hidden.join(", ")}. Nothing is deleted. You can show it again.</p> : null}
        {error ? <p className="cm-note" role="alert">{error}</p> : null}
        <div className="setup-actions"><button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save for everyone"}</button><button type="button" className="secondary" disabled={busy} onClick={() => setPreviewing(false)}>Keep arranging</button></div>
      </> : <>
        <p className="trip-letter__quiet">This changes how the page looks for your group. Dates, bookings and balances stay as they are.</p>
        <ul className="trip-letter__arrange-list">{draft.map((section, index) => <li key={section.id}>
          <span>{tripLetterSectionLabel(section.id)}{section.hidden ? " · Hidden" : ""}</span>
          <button type="button" className="secondary" aria-label={`Move ${tripLetterSectionLabel(section.id)} up`} disabled={index === 0} onClick={() => { setDraft(moveLetterSection(draft, section.id, -1)); setStatus(`${tripLetterSectionLabel(section.id)} moved up.`); }}>↑</button>
          <button type="button" className="secondary" aria-label={`Move ${tripLetterSectionLabel(section.id)} down`} disabled={index === TRIP_LETTER_SECTION_IDS.length - 1} onClick={() => { setDraft(moveLetterSection(draft, section.id, 1)); setStatus(`${tripLetterSectionLabel(section.id)} moved down.`); }}>↓</button>
          <button type="button" className="secondary" aria-pressed={section.hidden} onClick={() => setDraft(draft.map(item => item.id === section.id ? { ...item, hidden: !item.hidden } : item))}>{section.hidden ? "Show" : "Hide"}</button>
        </li>)}</ul>
        <p className="sr-only" role="status">{status}</p>
        <button className="text-action" type="button" onClick={() => setDraft(DEFAULT_LETTER_SECTIONS)}>Reset to the default order</button>
        <div className="setup-actions"><button type="button" onClick={() => setPreviewing(true)}>Preview</button><button type="button" className="secondary" onClick={close}>Cancel</button></div>
      </>}
    </dialog>
  </>;
}
