"use client";

import type { PollStatus } from "@commons/contracts";
import { useState } from "react";

export function PollDetailControls({ pollId, slug, shareUrl, status: initialStatus, canManage, mode = "share" }: { pollId: string; slug: string; shareUrl: string; status: PollStatus; canManage: boolean; mode?: "share" | "status" }) {
  const [status, setStatus] = useState(initialStatus);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function copy() {
    setError("");
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setError("Couldn’t copy. Select the link above and copy it."); }
  }
  async function toggle() {
    if (busy) return;
    setBusy(true); setError("");
    const next = status === "open" ? "closed" : "open";
    try {
      const response = await fetch(`/api/v1/commons/${slug}/polls/${pollId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: crypto.randomUUID(), status: next }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Poll not updated. Try again.");
      setStatus(payload.poll.status);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Poll not updated. Try again.");
      setBusy(false);
    }
  }

  return <section className={mode === "share" ? "poll-share-controls" : "poll-action-row"}>{mode === "share" ? <><label className="fieldnotes-field"><span>Poll link</span><input readOnly value={shareUrl} /></label><button className="cm-action" type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button><span className="sr-only" role="status">{copied ? "Link copied" : ""}</span></> : canManage ? <button className="cm-action" type="button" onClick={() => void toggle()} disabled={busy}>{busy ? "Updating…" : status === "open" ? "Close voting" : "Reopen voting"}</button> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}</section>;
}
