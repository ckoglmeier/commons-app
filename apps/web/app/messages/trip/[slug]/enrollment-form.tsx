"use client";
import { useRef, useState } from "react";
import { PhoneVerification } from "@/components/phone-verification";

export function EnrollmentForm({ slug, tripName, consentText, enrolled: initial, optedOut, verifiedPhone: initialPhone }: { slug: string; tripName: string; consentText: string; enrolled: boolean; optedOut: boolean; verifiedPhone: string | null }) {
  const [enrolled, setEnrolled] = useState(initial), [busy, setBusy] = useState(false), [agreed, setAgreed] = useState(false);
  const [phone, setPhone] = useState(initialPhone), [changing, setChanging] = useState(false);
  const [message, setMessage] = useState<{ tone: "status" | "error"; text: string } | null>(null);
  const sending = useRef(false);
  const endpoint = `/api/v1/commons/${encodeURIComponent(slug)}/messaging`;

  async function submit(method: "POST" | "DELETE") {
    if (sending.current) return;
    sending.current = true; setBusy(true); setMessage(null);
    try {
      const response = await fetch(endpoint, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? JSON.stringify({ consent: true }) : undefined });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage({ tone: "error", text: body?.error?.message ?? "That didn’t go through. Nothing was changed." }); return; }
      setEnrolled(method === "POST");
      setMessage({ tone: "status", text: method === "POST" ? `Texts are on for ${tripName}. Commons will text you shortly.` : `Texts are off for ${tripName}. The trip works the same on the web.` });
    } catch { setMessage({ tone: "error", text: "That didn’t go through. Nothing was changed. Try again." }); }
    finally { sending.current = false; setBusy(false); }
  }
  const status = <div aria-live="polite">{message ? <p className={message.tone === "error" ? "form-error" : "entry-footnote"} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}</div>;

  if (enrolled) return <div className="review-actions">
    <p>Texts are on for {tripName}{phone ? ` at ${phone}` : ""}.</p>
    <button type="button" className="sheet-secondary" disabled={busy} onClick={() => void submit("DELETE")}>{busy ? "Working…" : "Turn off texts for this trip"}</button>
    {status}
  </div>;

  if (!phone || changing) return <div className="review-actions">
    <p>{phone ? "Enter your new number. Texts for your other trips stop until you turn them on again." : "First, confirm your mobile number. We’ll text you a code. This doesn’t turn on texts."}</p>
    <PhoneVerification onVerified={verified => { setPhone(verified); setChanging(false); setMessage({ tone: "status", text: `${verified} is confirmed. Texts are still off.` }); }} onCancel={phone ? () => setChanging(false) : undefined} />
    {status}
  </div>;

  return <div className="review-actions">
    <form onSubmit={event => { event.preventDefault(); void submit("POST"); }}>
      {optedOut ? <p>You replied STOP earlier. Turning texts on here starts them again for this trip.</p> : null}
      <div className="profile-contact-row"><div><span>Your mobile number</span><strong>{phone}</strong><small>Confirmed</small></div>
        <button type="button" onClick={() => { setChanging(true); setMessage(null); }}>Change</button></div>
      <label className="check-row"><input type="checkbox" required checked={agreed} onChange={event => setAgreed(event.target.checked)} /><span>{consentText}</span></label>
      <button type="submit" className="sheet-primary" disabled={busy || !agreed}>{busy ? "Turning on…" : "Turn on texts"}</button>
    </form>
    {status}
  </div>;
}
