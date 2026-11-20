"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { messageParts } from "@commons/domain";
import { personFacingError } from "@/lib/person-facing-error";

type Thread = {
  optedOut: boolean;
  trips: Array<{ id: string; name: string; on: boolean }>;
  /** Commons's messages are listed once they've gone out; anything held for quiet hours appears in the morning. */
  messages: Array<{ id: string; from: "you" | "commons"; body: string; at: string }>;
  /** Something Commons started is held for quiet hours. Only that it waits: its words and time stay on the server. */
  waitingForMorning: boolean;
};

const time = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// The server and the browser may be in different time zones, so a time is written only once the browser has taken over.
const noSubscription = () => () => {};
const useHydrated = () => useSyncExternalStore(noSubscription, () => true, () => false);

/** Commons's links to this site's own pages are links; anything else, and everything a person wrote, stays text. */
function Body({ from, body, siteOrigin }: { from: "you" | "commons"; body: string; siteOrigin: string | null }) {
  if (from !== "commons") return <p>{body}</p>;
  return <p>{messageParts(body, siteOrigin).map((part, index) => part.href ? <a key={index} className="message-thread-link" href={part.href}>{part.text}</a> : <Fragment key={index}>{part.text}</Fragment>)}</p>;
}

export function WebThread({ initial, siteOrigin }: { initial: Thread; siteOrigin: string | null }) {
  const hydrated = useHydrated();
  const [thread, setThread] = useState(initial), [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const sending = useRef(false), pendingId = useRef<string | null>(null), end = useRef<HTMLDivElement>(null);
  const messages = thread.messages;
  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }); }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body || sending.current) return;
    sending.current = true; setBusy(true); setError("");
    pendingId.current ??= crypto.randomUUID(); // a retry after a failure keeps its id, so it can't arrive twice
    try {
      const response = await fetch("/api/v1/messaging/web", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: pendingId.current, body }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "That didn’t go through. Try again.");
      setThread(payload as Thread); setText(""); pendingId.current = null;
    } catch (failure) { setError(personFacingError(failure, "That didn’t go through. Try again.")); }
    finally { sending.current = false; setBusy(false); }
  }

  const on = thread.trips.filter(trip => trip.on), off = thread.trips.filter(trip => !trip.on);
  return <div className="message-thread">
    {thread.optedOut ? <p className="entry-footnote" role="status">You sent STOP, so Commons won’t start messages. Send START to turn them back on.</p> : null}
    {on.length ? <p className="entry-footnote message-thread-on">On for {on.map((trip, index) => <Fragment key={trip.id}>{index ? ", " : ""}<Link href={`/messages/trip/${trip.id}`}>{trip.name}</Link></Fragment>)}.</p> : null}
    {off.length ? <ul className="message-thread-trips" aria-label="Trips with messages off">
      {off.map(trip => <li key={trip.id}><Link href={`/messages/trip/${trip.id}`}>Turn on for {trip.name}</Link></li>)}
    </ul> : null}
    {thread.waitingForMorning ? <p className="entry-footnote" role="status">Commons has a message for you. It’s quiet hours for that trip, so it arrives in the morning.</p> : null}
    <ol className="message-thread-messages" aria-label="Conversation with Commons" aria-live="polite">
      {messages.length ? messages.map(message => <li key={message.id} className={message.from === "you" ? "message-thread-message message-thread-message--you" : "message-thread-message"}>
        <span className="message-thread-author">{message.from === "you" ? "You" : "Commons"} · <time dateTime={message.at}>{hydrated ? time(message.at) : null}</time></span>
        <Body from={message.from} body={message.body} siteOrigin={siteOrigin} />
      </li>) : !on.length ? <li className="entry-footnote">Nothing yet. Turn messages on for a trip and Commons will say hello.</li> : thread.waitingForMorning ? null : <li className="entry-footnote">Nothing yet. Commons will write when there’s something to ask.</li>}
    </ol>
    <div ref={end} />
    <form className="message-thread-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      <label className="field"><span>Message Commons</span>
        <textarea name="message" rows={2} maxLength={1600} value={text} onChange={event => { setText(event.target.value); pendingId.current = null; }} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} /></label>
      <div className="phone-verify-actions">
        <button type="submit" className="sheet-primary" disabled={busy || !text.trim()}>{busy ? "Sending…" : "Send"}</button>
      </div>
    </form>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </div>;
}
