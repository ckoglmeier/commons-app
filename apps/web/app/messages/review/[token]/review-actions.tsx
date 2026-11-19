"use client";
import { useRef, useState } from "react";
import type { ReviewView } from "@/lib/server/messaging/web";

type Notice = { tone: "status" | "error"; text: string } | null;
const REASON: Record<string, string> = {
  unreadable: "Commons couldn’t read booking details from that. Check it and try again, or enter the booking on the Travel page.",
  needs_info: "One more detail is needed before this can be reviewed.",
  duplicate: "That booking is already saved on your trip.",
  not_permitted: "Lodging is added to the trip by an organizer, so this stay can’t be saved from here.",
  in_progress: "That is already waiting for your review.",
};

export function ReviewActions({ token, view }: { token: string; view: ReviewView }) {
  const [current, setCurrent] = useState(view);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<Notice>(null), [text, setText] = useState("");
  const sending = useRef(false);
  const file = useRef<HTMLInputElement>(null);

  async function reload() {
    const response = await fetch(`/api/v1/messaging/review/${encodeURIComponent(token)}`, { cache: "no-store" });
    if (response.ok) setCurrent(await response.json());
  }
  async function run(work: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setNotice(null);
    try { await work(); } catch { setNotice({ tone: "error", text: "That didn’t go through. Nothing was changed. Try again." }); }
    finally { sending.current = false; setBusy(false); }
  }
  const decide = (action: "approve" | "decline") => run(async () => {
    const response = await fetch(`/api/v1/messaging/review/${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, version: current.version }) });
    if (!response.ok) { await reload(); setNotice({ tone: "error", text: "This summary changed or couldn’t be saved, so nothing was saved. Check the latest version below." }); return; }
    await reload();
    setNotice({ tone: "status", text: action === "approve" ? "Saved to your trip." : "Discarded. Nothing was saved." });
  });
  const addSource = (body: BodyInit, headers?: Record<string, string>) => run(async () => {
    const response = await fetch(`/api/v1/messaging/review/${encodeURIComponent(token)}/source`, { method: "POST", body, headers });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setNotice({ tone: "error", text: result?.error?.message ?? "That didn’t go through. Nothing was changed." }); return; }
    await reload();
    setText(""); if (file.current) file.current.value = "";
    setNotice(result.outcome === "review" ? { tone: "status", text: "Here’s what Commons read. Check it, then save." } : { tone: "error", text: result.outcome === "needs_info" ? `${REASON.needs_info} ${result.question ?? ""}` : REASON[result.outcome] ?? REASON.unreadable });
  });

  const heading = current.status === "saved" ? "Saved to your trip" : current.status === "awaiting_review" ? "Check this booking" : "Add your booking details";
  const intro = current.status === "awaiting_review" ? "This is what Commons read from what you sent. Nothing is saved until you choose Save."
    : current.status === "saved" ? "This booking is on your trip. You can edit it on the Travel page."
    : "Paste your confirmation or add a PDF or screenshot. Commons shows you what it read before anything is saved.";
  return <>
    <div className="entry-copy"><span className="view-kicker">{current.tripName}</span><h1 id="review-title">{heading}</h1><p>{intro}</p></div>
    <div className="review-actions">
    {current.expired ? <p className="form-error" role="alert">This link has expired. Text Commons your booking again for a new one.</p> : null}
    {current.lines.length ? <section aria-labelledby="read-title">
      <h2 id="read-title" className="view-kicker">What Commons read</h2>
      {current.classification === "change" ? <p>This looks like a change to a booking already saved. Saving replaces the saved details.</p> : null}
      {current.classification === "cancellation" ? <p>This looks like a cancellation. Saving removes the matching booking from your trip.</p> : null}
      <ul>{current.lines.map(line => <li key={line}>{line}</li>)}</ul>
      {current.confirmationCode ? <p>Confirmation code <span className="mono">{current.confirmationCode}</span> (private)</p> : null}
      {current.sharing ? <p>{current.sharing}</p> : null}
      {current.uncertain.length ? <><h3>Check these</h3><ul>{current.uncertain.map(item => <li key={item}>{item}</li>)}</ul></> : null}
    </section> : null}
    {current.canApprove ? <>
      <button type="button" className="sheet-primary" disabled={busy} onClick={() => void decide("approve")}>{busy ? "Working…" : `Save to ${current.tripName}`}</button>
      <button type="button" className="sheet-secondary" disabled={busy} onClick={() => void decide("decline")}>Discard</button>
    </> : null}
    {current.canAddSource ? <section aria-labelledby="add-title">
      <h2 id="add-title" className="view-kicker">{current.lines.length ? "Replace with different details" : "Add booking details"}</h2>
      <label className="field"><span>Paste the confirmation</span><textarea rows={6} value={text} maxLength={20000} onChange={event => setText(event.target.value)} /></label>
      <button type="button" className="sheet-secondary" disabled={busy || text.trim().length < 10} onClick={() => void addSource(JSON.stringify({ text }), { "content-type": "application/json" })}>Read pasted details</button>
      <label className="field"><span>Or add a PDF or screenshot <small>Up to 10 MB</small></span><input ref={file} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" /></label>
      <button type="button" className="sheet-secondary" disabled={busy} onClick={() => { const chosen = file.current?.files?.[0]; if (!chosen) { setNotice({ tone: "error", text: "Choose a file first." }); return; } const form = new FormData(); form.set("file", chosen); void addSource(form); }}>Read this file</button>
    </section> : null}
    <div aria-live="polite">{notice ? <p className={notice.tone === "error" ? "form-error" : "entry-footnote"} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p> : null}</div>
    {current.lines.length ? null : <p className="entry-footnote">Your confirmation code and the original message stay private to you.</p>}
    </div>
  </>;
}
