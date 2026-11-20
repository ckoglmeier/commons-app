"use client";
import Link from "next/link";
import { useRef, useState } from "react";

/** Turns messages in Commons on or off for one trip. Consent is the checkbox, for this trip only; turning it off keeps the trip the same on the web. */
export function WebMessagesForm({ slug, tripName, consentText, on: initial, onPhone, justJoined }: { slug: string; tripName: string; consentText: string; on: boolean; onPhone: boolean; justJoined: boolean }) {
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
      // "On" is said once, by the line the live region already shows while messages are on.
      setMessage(next ? null : { tone: "status", text: `Messages are off for ${tripName}. The trip works the same without them.` });
    } catch { setMessage({ tone: "error", text: "That didn’t go through. Nothing was changed. Try again." }); }
    finally { sending.current = false; setBusy(false); }
  }
  // One polite live region that stays mounted whether messages are on or off, so turning them on is announced once and shown once.
  const status = <div aria-live="polite">{message ? <p className={message.tone === "error" ? "form-error" : "entry-footnote"} role={message.tone === "error" ? "alert" : undefined}>{message.text}</p> : on ? <p>Messages are on for {tripName}.</p> : null}</div>;
  const trip = `/c/${slug}/`;
  const footer = <p className="entry-footnote">{justJoined ? <Link className="entry-footnote-link" href={trip}>{on ? "Go to the trip" : "Not now, go to the trip"}</Link> : on ? <Link className="entry-footnote-link" href={trip}>Back to the trip</Link> : <>Not for you? Nothing changes. {" "}<Link className="entry-footnote-link" href={trip}>Back to the trip</Link></>}</p>;

  if (on) return <>
    <div className="review-actions">
      {status}
      <Link className="sheet-primary" href="/messages">Open Messages</Link>
      <button type="button" className="sheet-secondary" disabled={busy} onClick={() => void submit(false)}>{busy ? "Working…" : "Turn off for this trip"}</button>
    </div>
    {footer}
  </>;

  return <>
    <div className="review-actions">
      {status}
      <form onSubmit={event => { event.preventDefault(); void submit(true); }}>
        {onPhone ? <p>Texts for this trip go to your phone now. Turning on messages here moves them to Commons instead.</p> : null}
        <label className="check-row"><input type="checkbox" required checked={agreed} onChange={event => setAgreed(event.target.checked)} /><span>{consentText}</span></label>
        <button type="submit" className="sheet-primary" disabled={busy || !agreed}>{busy ? "Turning on…" : "Turn on messages"}</button>
      </form>
    </div>
    {footer}
  </>;
}
