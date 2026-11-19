"use client";
import { useRef, useState } from "react";
import type { GroupInvitationPreview } from "@commons/contracts";
export function JoinGroupAction({ token, preview, textMessagingOffered = false }: { token: string; preview: GroupInvitationPreview; textMessagingOffered?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const command = useRef<string | null>(null), sending = useRef(false);
  async function join() {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(""); command.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/group-invitations/${encodeURIComponent(token)}/join`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: command.current, tripId: preview.tripId, linkId: preview.linkId, version: preview.version }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Joining couldn’t be confirmed. Try again with this same account.");
      if (body.tripId !== preview.tripId || body.destination !== `/c/${preview.tripId}/`) throw new Error("Joining couldn’t be confirmed. Reload this invitation.");
      window.location.assign(textMessagingOffered ? `/messages/trip/${preview.tripId}?joined=1` : body.destination);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Joining couldn’t be confirmed. Try again."); }
    finally { sending.current = false; setBusy(false); }
  }
  return <><button type="button" className="sheet-primary" disabled={busy} onClick={() => void join()}>{busy ? "Joining…" : "Join the trip"}</button>{error ? <p className="form-error" role="alert">{error}</p> : null}</>;
}
