"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function responseError(response: Response, fallback: string) {
  const text = await response.text();
  try {
    const payload = text ? JSON.parse(text) as { error?: unknown } : null;
    if (typeof payload?.error === "string") return payload.error;
  } catch {
    // The fallback is more useful than an invalid response body.
  }
  return fallback;
}

export function TripLifecycleAction({
  slug,
  name,
  archived,
}: {
  slug: string;
  name: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function update() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/commons/${slug}/archive`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), archived: !archived }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "Trip status not changed. Try again."));
      }
      if (!archived) {
        router.push("/trips");
        router.refresh();
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Trip status not changed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        className="trip-archive-action"
        type="button"
        onClick={() => { setConfirming(true); setError(""); }}
      >
        {archived ? "Restore trip" : "Archive trip"}
      </button>
    );
  }

  return (
    <div className="trip-lifecycle-confirm trip-lifecycle-confirm--people" role="group" aria-label={archived ? `Restore ${name}` : `Archive ${name}`}>
      <strong>{archived ? `Restore ${name}?` : `Archive ${name}?`}</strong>
      <p>{archived
        ? "This returns the trip to everyone’s event list."
        : "This moves the trip to Archived for everyone. Plans, messages, expenses, photos, and access stay as they are."}</p>
      <div>
        <button type="button" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
        <button type="button" onClick={() => void update()} disabled={busy}>
          {busy ? "Saving…" : archived ? "Restore trip" : "Archive trip"}
        </button>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}
