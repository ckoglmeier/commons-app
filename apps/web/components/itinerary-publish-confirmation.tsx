"use client";
import { useEffect, useRef } from "react";
export function ItineraryPublishConfirmation({ title, access, onAccess, busy, error, changes = false, onClose, onPublish }: {
  title: string; access: "invitees" | "link"; onAccess: (value: "invitees" | "link") => void;
  busy: boolean; error?: string; changes?: boolean; onClose: () => void; onPublish: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const focus = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { element?.close(); focus?.focus?.(); };
  }, []);
  return <dialog ref={dialog} className="itinerary-share-dialog itinerary-publish-confirmation" aria-labelledby="itinerary-publish-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="itinerary-publish-title">Share with the group?</h2><p>{title}</p>
    <fieldset disabled={busy}><legend>Who can respond?</legend>
      <label><input type="radio" name="itinerary-publication-access" checked={access === "invitees"} onChange={() => onAccess("invitees")} /> Invited travelers (sign-in required)</label>
      <label><input type="radio" name="itinerary-publication-access" checked={access === "link"} onChange={() => onAccess("link")} /> Anyone with the link</label>
    </fieldset>
    <p>{access === "invitees" ? "Trip invitees can open this version and respond after signing in." : "Anyone with this link can view this version, respond and see its visible results."}</p>
    <p>No email or SMS notifications will be sent. You can send the link afterward.</p>
    {changes ? <p>This creates a new shared version. Earlier responses stay with their original version.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="itinerary-actions"><button type="button" className="cm-action" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="cm-action cm-action--primary" disabled={busy} onClick={onPublish}>{busy ? "Sharing…" : "Share with the group"}</button></div>
  </dialog>;
}
