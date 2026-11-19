"use client";

import { useState } from "react";

export function PollResponseDelete({
  pollId,
  responseId,
  respondentName,
  slug,
}: {
  pollId: string;
  responseId: string;
  respondentName: string;
  slug: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/commons/${slug}/polls/${pollId}/responses/${responseId}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Response not deleted. Try again.");
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Response not deleted. Try again.");
      setDeleting(false);
    }
  }

  return <div className="poll-response-delete">
    {confirming ? <div className="poll-response-delete-confirm">
      <p>Delete {respondentName}’s response? Their answers will be removed from this poll.</p>
      <div>
        <button type="button" disabled={deleting} onClick={() => { setConfirming(false); setError(""); }}>Keep response</button>
        <button type="button" disabled={deleting} onClick={() => void remove()}>{deleting ? "Deleting…" : "Delete response"}</button>
      </div>
    </div> : <button type="button" onClick={() => setConfirming(true)}>Delete response</button>}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </div>;
}
