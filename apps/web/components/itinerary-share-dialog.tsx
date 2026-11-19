"use client";
import type { PollWorkingData } from "@commons/contracts";
import { publishedPollMessage } from "@/lib/coordinator-sharing";
import { useEffect, useRef, useState } from "react";

export function ItineraryShareDialog({ url, title, onClose, access, data }: { data?: PollWorkingData; url: string; title: string; onClose: () => void; access: "invitees" | "link" }) {
  const dialog = useRef<HTMLDialogElement>(null), [status, setStatus] = useState("");
  useEffect(() => { const element=dialog.current; element?.showModal(); return () => element?.close(); }, []);
  async function copy(value: string, message: string) {
    try { await navigator.clipboard.writeText(value); setStatus(message); } catch { setStatus("Copy couldn’t complete. Select and copy the link below."); }
  }
  const message = data ? publishedPollMessage(data,url) : `Here’s our proposed itinerary. Let us know what you think:\n\n${url}`;
  return <dialog ref={dialog} className="itinerary-share-dialog" onCancel={event=>{event.preventDefault();onClose();}}>
    <div className="itinerary-actions"><button className="cm-action" onClick={onClose}>Close</button></div><h2>Share the poll</h2><p>Your itinerary poll is published to the trip.</p>
    <div className="itinerary-actions"><button className="cm-action" onClick={() => void copy(url, "Link copied.")}>Copy link</button><a className="cm-action" href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(message)}`}>Share by email</a><button className="cm-action" onClick={() => void copy(message, "Message copied. Paste it into your group chat.")}>Copy for group chat</button></div>
    <p className="itinerary-share-url"><a href={url}>{url}</a></p><p>{access === "invitees" ? "Invited travelers sign in to respond." : "Anyone with this link can view the itinerary and respond."}</p>{status ? <p role="status">{status}</p> : null}
  </dialog>;
}
