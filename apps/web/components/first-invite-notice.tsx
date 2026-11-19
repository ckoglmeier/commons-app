"use client";

import { useEffect, useState } from "react";
import { GoingAction } from "./trip-stage-gate";

type Status = { draftId: string | null; feeCents: number; required: boolean; state: string; mayInvite: boolean; savedPeople: { name: string }[]; unsentInvitees: string[]; reconciliationNeeded: boolean };

/** People's entry into the first-invite flow. Plain until the Trip design round places it. Exempt trips still show people waiting for an invitation. */
export function FirstInviteNotice({ slug, onMayInvite, onActionChange, prominent = false, beforeGoing = false }: {
  slug: string;
  onMayInvite: (mayInvite: boolean) => void;
  /** Tells a parent there's a first-invite step, so it doesn't also say nothing is waiting or offer another primary action. */
  onActionChange?: (hasAction: boolean) => void;
  prominent?: boolean;
  /** New-experience People remains read-only until the organizer commits the trip. */
  beforeGoing?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    let live = true;
    onMayInvite(false);
    void fetch(`/api/v1/trip-activation/status?trip=${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then(response => { if (!response.ok) throw new Error("status"); return response.json() as Promise<{ status: Status }>; })
      .then(payload => { if (live && payload) { setStatus(payload.status); setFailed(false); onMayInvite(payload.status.mayInvite && !beforeGoing); onActionChange?.(beforeGoing || !payload.status.mayInvite || payload.status.savedPeople.length + payload.status.unsentInvitees.length > 0); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [slug, onMayInvite, onActionChange, beforeGoing, retry]);
  if (failed) return <div className="first-invite-entry"><p role="alert">We couldn’t check invitations. Your trip is unchanged.</p><button type="button" className="button-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button></div>;
  if (!status) return beforeGoing ? <p role="status">Checking invitations…</p> : null;
  if (beforeGoing && ["allowed", "exempt", "payment_required"].includes(status.state)) return <section className="first-invite-entry" aria-label="Invite people when you’re ready">
    <p>Keep gathering interest on Trip. When you’re ready, invite people to join.</p>
    <GoingAction slug={slug} intent="invite" inviteFlowAvailable={Boolean(status.draftId)} offer={{ upgrade: status.state === "payment_required", paid: status.state === "allowed" }} />
  </section>;
  if (status.reconciliationNeeded) return <p className="first-invite-note" role="status">A refund of the trip fee was recorded. Everyone keeps their access. If you shared the fee, check it in Money.</p>;
  const waiting = status.savedPeople.length + status.unsentInvitees.length;
  if (status.mayInvite && !waiting) return null;
  const line = status.mayInvite ? `${waiting} not yet invited.`
    : status.state === "approval_revoked" ? "Inviting is paused on this account. People already on the trip keep their access."
    : status.state === "refund_hold" ? "Inviting is on hold while Commons reviews a refund."
    : status.state === "payment_processing" ? "Your payment is being confirmed. Nobody has been contacted."
    : "This trip is private. The $20 trip fee comes before the first invitation.";
  const canAct = status.mayInvite || ["payment_required", "payment_processing"].includes(status.state);
  const label = status.mayInvite ? "Send invitations" : canAct ? "Invite your group" : "See status";
  return <div className={prominent ? "first-invite-entry first-invite-entry--prominent" : "first-invite-entry"}><p>{line}</p><a className={prominent && canAct ? "view-primary-action" : "button-secondary"} href={`/c/${slug}/first-invite`}>{label}</a></div>;
}
