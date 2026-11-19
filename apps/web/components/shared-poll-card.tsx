"use client";
import { useState } from "react";
import type { CoordinatorThread } from "@commons/contracts";
export function SharedPollCard({poll,slug}: {poll:CoordinatorThread["polls"][number];slug:string}) {
  const [copied,setCopied] = useState(false), [fallback,setFallback] = useState<string|null>(null);
  const path = `/c/poll/${poll.publicId}`;
  async function copy() { const url = new URL(path,window.location.origin).href; try { await navigator.clipboard.writeText(url); setCopied(true); setFallback(null); } catch { setFallback(url); } }
  return <section className="workspace-artifact workspace-shared-poll" aria-label={`Shared poll: ${poll.title}`}>
    <h3>{poll.title}</h3><p>Shared · {poll.status === "open" ? "Open" : "Closed"}{poll.superseded ? " · Earlier version" : ""} · {poll.responseCount} {poll.responseCount===1 ? "response" : "responses"}</p>
    <p className="review-caption">Link created. This doesn’t confirm any email was delivered.</p>
    <div className="workspace-actions"><a className="cm-action" href={path}>Open poll</a><button className="cm-action" type="button" onClick={()=>void copy()}>Copy link</button><a className="cm-action" href={`/c/${slug}/polls/${poll.id}`}>View results</a></div>
    {copied ? <p role="status">Link copied.</p> : null}{fallback ? <label>Copy this link<input readOnly value={fallback} onFocus={event=>event.currentTarget.select()} /></label> : null}
  </section>;
}
