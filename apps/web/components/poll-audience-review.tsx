"use client";
import type { PollDetail } from "@commons/contracts";
import { useRef, useState } from "react";
import { personFacingError } from "@/lib/person-facing-error";

export function PollAudienceReview({ slug, pollId, audience, people }: { slug: string; pollId: string; audience: NonNullable<PollDetail["audienceReview"]>; people: Array<{ id: string; name: string }> }) {
  const [selected, setSelected] = useState<{ kind: "person" | "email"; recipient: string; label: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const command = useRef<string | null>(null);
  const recipients: Array<{ kind: "person" | "email"; recipient: string; label: string }> = [
    ...audience.personIds.map(id => ({ kind: "person" as const, recipient: id, label: people.find(person => person.id === id)?.name ?? "Trip participant" })),
    ...audience.guestEmails.map(email => ({ kind: "email" as const, recipient: email, label: email })),
  ];
  async function revoke() {
    if (!selected || busy) return;
    setBusy(true); setError(""); command.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/polls/${pollId}/audience`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selected, commandId: command.current, fingerprint: audience.fingerprint }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Access not changed.");
      window.location.reload();
    } catch (cause) { setError(personFacingError(cause, "Access not changed. Try again.")); setBusy(false); }
  }
  return <section className="poll-responses"><h2>Who can answer?</h2><p>Only these accounts, the creator, and organizers. Share the poll link with them. Response-only guests can’t open the trip.</p>
    <ul className="event-attendance-list">{recipients.map(recipient => <li key={`${recipient.kind}:${recipient.recipient}`}><span>{recipient.label} · {recipient.kind === "person" ? "Trip participant" : "Response only"}</span><button type="button" className="cm-action cm-action--quiet" disabled={busy} onClick={() => { setSelected(recipient); command.current = null; }}>Remove access</button></li>)}</ul>
    {selected ? <div><h3>Remove {selected.label}’s poll access?</h3><p>They won’t be able to open or answer this poll. Past responses stay. Their trip membership and organizer role don’t change.</p><div className="poll-action-row"><button className="cm-action" type="button" disabled={busy} onClick={() => setSelected(null)}>Cancel</button><button className="cm-action cm-action--danger" type="button" disabled={busy} onClick={revoke}>{busy ? "Removing…" : "Confirm removal"}</button></div></div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
