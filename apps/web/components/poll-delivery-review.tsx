"use client";

import { useRef, useState } from "react";

type Delivery = { fingerprint: string; recipients: Array<{ email: string; personId: string | null; status: string; errorCode: string | null }>; missingPersonIds: string[] };
const statusLabels: Record<string, string> = { not_sent: "Not sent", queued: "Queued", processing: "Sending", sent: "Sent", failed: "Needs attention", cancelled: "Cancelled" };
const errorLabels: Record<string, string> = { access_changed: "Access changed; review the audience.", operator_review_required: "Retry limit reached. Contact support.", delivery_disabled: "Email delivery is disabled.", email_not_configured: "Email needs server configuration.", provider_rejected: "The email provider rejected delivery.", provider_unavailable: "The email provider could not be reached." };

export function PollDeliveryReview({ slug, pollId, people, includesMessage = false }: { slug: string; pollId: string; people: Array<{ id: string; name: string }>; includesMessage?: boolean }) {
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const command = useRef<string | null>(null);
  const locked = useRef(false);
  async function request(send: boolean) {
    if (locked.current || (send && !delivery)) return;
    locked.current = true; setBusy(true); setError(""); setNotice("");
    if (send) command.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/polls/${pollId}/delivery`, send ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: command.current, fingerprint: delivery!.fingerprint, approved: true }) } : { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Delivery could not be updated.");
      setDelivery(payload.delivery); command.current = null;
      if (send) setNotice("Delivery requested. Refresh to check progress. Links already sent aren’t sent again.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Delivery could not be updated."); }
    finally { locked.current = false; setBusy(false); }
  }
  return <section className="poll-delivery" aria-label="Poll email delivery">
    <p>{includesMessage ? "The email has the approved group message, its source links, and a link to the poll. It never includes the private review conversation or poll answers." : "Review the addresses first. The email has only a sign-in link to this poll. No event details or answers."}</p>
    {delivery ? <>
      <ul>{delivery.recipients.map(recipient => <li key={recipient.email}><span className="fieldnotes-wrap">{recipient.email}</span> · {statusLabels[recipient.status] ?? "Needs attention"}{recipient.errorCode ? <p>{errorLabels[recipient.errorCode] ?? "Delivery needs review."}</p> : null}</li>)}</ul>
      {delivery.missingPersonIds.length ? <p>No verified delivery address for {delivery.missingPersonIds.map(id => people.find(person => person.id === id)?.name ?? "a selected person").join(", ")}. Use People to review their invitation, or share the poll link directly.</p> : null}
      <p>Send to these {delivery.recipients.length} addresses? This doesn’t confirm attendance or change event access. Links already sent aren’t sent again. Failed sends can be retried for a while.</p>
      <button className="cm-action cm-action--primary" type="button" disabled={busy || !delivery.recipients.some(item => ["not_sent", "failed", "queued", "processing"].includes(item.status) && item.errorCode !== "operator_review_required")} onClick={() => void request(true)}>{includesMessage ? "Send approved message and poll" : "Send reviewed links"}</button>
    </> : null}
    <button className="cm-action" type="button" disabled={busy} onClick={() => void request(false)}>{delivery ? "Refresh delivery status" : "Review recipients"}</button>
    {notice ? <p role="status">{notice}</p> : null}{error ? <p role="alert" className="form-error">{error}</p> : null}
  </section>;
}
