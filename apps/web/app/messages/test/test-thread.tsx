"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PhoneVerification } from "@/components/phone-verification";

type Thread = {
  phone: string | null; suggestedPhone: string;
  trips: Array<{ id: string; name: string; enrolled: boolean }>;
  messages: Array<{ id: string; from: "you" | "commons"; body: string; status: string; detail: string | null; waitingUntil: string | null; at: string }>;
};

/** Replies that exercise each piece on a test trip. Tapping one fills the reply box; nothing sends until Send. */
const TRY = ["yes", "Pizza", "what's next", "what's the address for dinner", "when is the hike", "I covered dinner, $120, me and Sam", "I paid Sam $40", "HELP"];

/** Says what happened to a message that hasn't simply gone out. Queued is never shown as sent. */
function deliveryNote(message: Thread["messages"][number]) {
  if (message.from === "you" || ["sent", "delivered"].includes(message.status)) return null;
  if (message.status === "queued") {
    const until = message.waitingUntil ? new Date(message.waitingUntil).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
    return message.detail === "quiet_hours" ? `Waiting for morning${until ? `, ${until}` : ""}` : `Waiting to send${until ? `, ${until}` : ""}`;
  }
  if (message.status === "sending") return "Sending";
  if (message.status === "suppressed") return "Not sent: no longer needed";
  return "Not sent";
}

export function TestThread({ initial }: { initial: Thread }) {
  const [thread, setThread] = useState(initial), [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const sending = useRef(false), pendingId = useRef<string | null>(null), end = useRef<HTMLDivElement>(null);
  const shown = thread.messages.length;
  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }); }, [shown]);

  async function call(method: "GET" | "POST", body?: object) {
    if (sending.current) return false;
    sending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/messaging/test-thread", { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "That didn’t go through. Try again.");
      setThread(payload as Thread);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That didn’t go through. Try again.");
      return false;
    } finally { sending.current = false; setBusy(false); }
  }
  async function send() {
    const body = text.trim();
    if (!body) return;
    pendingId.current ??= crypto.randomUUID(); // a retry after a failure keeps its id, so it can't arrive twice
    if (await call("POST", { id: pendingId.current, body })) { setText(""); pendingId.current = null; }
  }

  if (!thread.phone) return <div className="review-actions">
    <p>First, confirm your test number. It’s fictional, and the code will show up here.</p>
    {thread.messages.length ? <ol className="message-thread-messages" aria-label="Codes sent to you" aria-live="polite">
      {thread.messages.map(message => <li key={message.id} className="message-thread-message"><span className="message-thread-author">Commons</span><p>{message.body}</p></li>)}
    </ol> : null}
    <PhoneVerification initialPhone={thread.suggestedPhone} onCodeSent={() => { sending.current = false; void call("GET"); }} onVerified={() => void call("GET")} />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </div>;

  const off = thread.trips.filter(trip => !trip.enrolled);
  return <div className="test-thread">
    <p className="entry-footnote">Test number {thread.phone}</p>
    <div className="test-thread-start">
      <p>Start a test trip to try it quickly. It’s a private trip with a fictional traveler named Sam, a dinner, a hike, a cabin and a poll. Starting it turns texts on for it, and turns them off for your last test trip.</p>
      <button type="button" className="sheet-secondary" disabled={busy} onClick={() => void call("POST", { testTrip: true })}>{busy ? "Working…" : "Start a test trip"}</button>
    </div>
    <div className="test-thread-try">
      <span className="message-thread-author" id="test-thread-try-label">Try sending</span>
      <ul aria-labelledby="test-thread-try-label">
        {TRY.map(example => <li key={example}><button type="button" onClick={() => { setText(example); pendingId.current = null; }}>{example}</button></li>)}
      </ul>
    </div>
    {off.length ? <ul className="message-thread-trips" aria-label="Trips with texts off">
      {off.map(trip => <li key={trip.id}><Link href={`/messages/trip/${trip.id}?channel=text`}>Turn on for {trip.name}</Link></li>)}
    </ul> : null}
    <ol className="message-thread-messages" aria-label="Conversation" aria-live="polite">
      {thread.messages.length ? thread.messages.map(message => {
        const note = deliveryNote(message);
        return <li key={message.id} className={message.from === "you" ? "message-thread-message message-thread-message--you" : "message-thread-message"}>
          <span className="message-thread-author">{message.from === "you" ? "You" : "Commons"}</span>
          <p>{message.body}</p>
          {note ? <small>{note}</small> : null}
        </li>;
      }) : <li className="entry-footnote">Nothing yet. Turn texts on for a trip, then check for new messages.</li>}
    </ol>
    <div ref={end} />
    <form className="message-thread-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      <label className="field"><span>Your reply</span>
        <textarea name="reply" rows={2} maxLength={1600} value={text} onChange={event => { setText(event.target.value); pendingId.current = null; }} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} /></label>
      <div className="phone-verify-actions">
        <button type="submit" className="sheet-primary" disabled={busy || !text.trim()}>{busy ? "Working…" : "Send"}</button>
        <button type="button" className="sheet-secondary" disabled={busy} onClick={() => void call("POST", { check: true })}>Check for new messages</button>
      </div>
    </form>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </div>;
}
