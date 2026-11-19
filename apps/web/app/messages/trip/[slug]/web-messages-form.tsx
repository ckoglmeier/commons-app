"use client";
import Link from "next/link";
import { useRef, useState } from "react";

/** Turns messages in Commons on or off for one trip. Consent is the checkbox, for this trip only; turning it off keeps the trip the same on the web. */
export function WebMessagesForm({ slug, tripName, consentText, on: initial, onPhone }: { slug: string; tripName: string; consentText: string; on: boolean; onPhone: boolean }) {
  const [on, setOn] = useState(initial), [busy, setBusy] = useState(false), [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState<{ tone: "status" | "error"; text: string } | null>(null);
  const sending = useRef(false);

  async function submit(next: boolean) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/messaging/web`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: next }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage({ tone: "error", text: body?.error?.message ?? "That didn’t go through. Nothing was changed." }); return; }
      setOn(next);
      setMessage({ tone: "status", text: next ? `Messages are on for ${tripName}.` : `Messages are off for ${tripName}. The trip works the same without them.` });
    } catch { setMessage({ tone: "error", text: "That didn’t go through. Nothing was changed. Try again." }); }
    finally { sending.current = false; setBusy(false); }
  }
  const status = <div aria-live="polite">{message ? <p className={message.tone === "error" ? "form-error" : "entry-footnote"} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}</div>;

  if (on) return <div className="review-actions">
    <p>Messages are on for {tripName}.</p>
    <Link className="sheet-primary" href="/messages">Open Messages</Link>
    <button type="button" className="sheet-secondary" disabled={busy} onClick={() => void submit(false)}>{busy ? "Working…" : "Turn off for this trip"}</button>
    {status}
  </div>;

  return <div className="review-actions">
    <form onSubmit={event => { event.preventDefault(); void submit(true); }}>
      {onPhone ? <p>Texts for this trip go to your phone now. Turning on messages here moves them to Commons instead.</p> : null}
      <label className="check-row"><input type="checkbox" required checked={agreed} onChange={event => setAgreed(event.target.checked)} /><span>{consentText}</span></label>
      <button type="submit" className="sheet-primary" disabled={busy || !agreed}>{busy ? "Turning on…" : "Turn on messages"}</button>
    </form>
    {status}
  </div>;
}
