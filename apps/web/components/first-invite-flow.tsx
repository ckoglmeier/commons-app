"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TripActivationStatus } from "@commons/database";
import { TRIP_FEE_DETAIL, TRIP_FEE_LABEL } from "@/lib/trip-activation/copy";

/*
 * The one first-invite flow: pay → confirming → say you're going → send → actual delivery states.
 * The setup Review step and /c/[trip]/first-invite both render it, and other screens link to that route. It holds no
 * payment truth of its own: every state comes from the server, and a return from checkout is never treated as payment.
 */

export type FirstInviteDelivery = { invitationId: string; recipientName: string; deliveryState: "sent" | "failed" | "queued" };

async function postJson<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "That didn’t go through. Your trip is saved. Try again.");
  return payload as T;
}

const CONFIRM_POLL_MS = 3000;
const CONFIRM_POLL_LIMIT = 20;

export function FirstInviteFlow({ draftId, tripSlug, people, checkout, keepPlanning, send, retryDelivery, doneHref, forHelp = false }: {
  /** Arrived from the AI poll help offer rather than to invite anyone. */
  forHelp?: boolean;
  draftId: string;
  /** Null before the trip exists, in setup Review. */
  tripSlug: string | null;
  /** Who this would invite, by name only. */
  people: string[];
  checkout: "returned" | "cancelled" | null;
  keepPlanning: { label: string; href?: string; onClick?: () => void; note?: string };
  /** Performs the explicit send and returns what actually happened to each invitation. */
  send: () => Promise<{ deliveries: FirstInviteDelivery[]; slug: string }>;
  retryDelivery: (slug: string, invitationId: string) => Promise<FirstInviteDelivery["deliveryState"]>;
  doneHref: (slug: string) => string;
}) {
  const [status, setStatus] = useState<TripActivationStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(checkout === "returned");
  const [confirmStalled, setConfirmStalled] = useState(false);
  const [deliveries, setDeliveries] = useState<FirstInviteDelivery[] | null>(null);
  const [sentSlug, setSentSlug] = useState<string | null>(tripSlug);
  const polls = useRef(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/trip-activation/status?draft=${encodeURIComponent(draftId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("status");
      const { status: next } = await response.json() as { status: TripActivationStatus };
      setStatus(next); setLoadFailed(false);
      return next;
    } catch { setLoadFailed(true); return null; }
  }, [draftId]);

  useEffect(() => {
    let live = true;
    void fetch(`/api/v1/trip-activation/status?draft=${encodeURIComponent(draftId)}`, { cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error("status"); return (await response.json() as { status: TripActivationStatus }).status; })
      .then(next => { if (live) setStatus(next); })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, [draftId]);

  const waiting = status?.state === "payment_processing" || (confirming && status?.state === "payment_required");
  useEffect(() => {
    if (!waiting || confirmStalled) return;
    const timer = setTimeout(() => {
      polls.current += 1;
      if (polls.current >= CONFIRM_POLL_LIMIT) { setConfirmStalled(true); return; }
      void load();
    }, CONFIRM_POLL_MS);
    return () => clearTimeout(timer);
  }, [waiting, confirmStalled, status, load]);

  /** Paid, and nobody to send to yet: saying "We're going" is the whole step. */
  async function declareGoing() {
    if (!tripSlug) return;
    setBusy(true); setError(null);
    try { await postJson(`/api/v1/commons/${encodeURIComponent(tripSlug)}/going`, {}); window.location.assign(doneHref(tripSlug)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "That didn’t save. Try again."); setBusy(false); }
  }

  async function pay() {
    setBusy(true); setError(null); setConfirming(false); setConfirmStalled(false);
    try {
      const result = await postJson<{ status: "paid" | "processing" | "open"; url?: string }>(`/api/v1/event-creation-drafts/${draftId}/checkout`, {});
      if (result.status === "open" && result.url) { window.location.assign(result.url); return; }
      setConfirming(result.status === "processing");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Checkout isn’t available right now. Your trip is saved and nothing was charged."); }
    setBusy(false);
  }

  async function sendInvitations() {
    setBusy(true); setError(null);
    try {
      const result = await send();
      setDeliveries(result.deliveries); setSentSlug(result.slug);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Invitations weren’t sent. Your trip is saved. Try again."); }
    finally { setBusy(false); }
  }

  async function retry(invitationId: string) {
    if (!sentSlug) return;
    setBusy(true); setError(null);
    try {
      const state = await retryDelivery(sentSlug, invitationId);
      setDeliveries(current => current?.map(row => row.invitationId === invitationId ? { ...row, deliveryState: state } : row) ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That invitation wasn’t sent. Try again."); }
    finally { setBusy(false); }
  }

  const keep = keepPlanning.href
    ? <a className="button-secondary" href={keepPlanning.href}>{keepPlanning.label}</a>
    : <button className="secondary" type="button" disabled={busy} onClick={keepPlanning.onClick}>{keepPlanning.label}</button>;
  const who = people.length ? <ul className="first-invite-people" aria-label="People to invite">{people.map(name => <li key={name}>{name}</li>)}</ul> : null;
  const errorLine = error ? <p className="form-error" role="alert">{error}</p> : null;

  if (deliveries) return <section className="first-invite" aria-labelledby="first-invite-heading">
    <h2 id="first-invite-heading">Invitations</h2>
    <ul className="first-invite-deliveries">{deliveries.map(row => <li key={row.invitationId}>
      <span>{row.recipientName}</span>
      {row.deliveryState === "sent" ? <strong>Sent</strong> : row.deliveryState === "queued" ? <strong>Queued</strong> : <span className="first-invite-retry"><strong>Not sent</strong><button className="secondary" type="button" disabled={busy} onClick={() => void retry(row.invitationId)}>Retry</button></span>}
    </li>)}</ul>
    {deliveries.length === 0 ? <p>No one was left to invite. You can add people from People.</p> : null}
    {errorLine}
    {sentSlug ? <div className="setup-actions setup-actions--single"><a className="button-secondary" href={doneHref(sentSlug)}>Open your trip</a></div> : null}
  </section>;

  if (loadFailed && !status) return <section className="first-invite"><p role="alert">We couldn’t check this trip’s status. It’s still saved.</p><div className="setup-actions"><button type="button" onClick={() => void load()}>Try again</button>{keep}</div></section>;
  if (!status) return <section className="first-invite"><p role="status">Checking your trip…</p></section>;

  switch (status.state) {
    case "approval_revoked": return <section className="first-invite" aria-labelledby="first-invite-heading">
      <h2 id="first-invite-heading">Inviting is paused</h2>
      <p>This account can’t send new invitations right now. Anyone already on the trip keeps their access.</p>
      <div className="setup-actions setup-actions--single">{keep}</div>
    </section>;
    case "refund_hold": return <section className="first-invite" aria-labelledby="first-invite-heading">
      <h2 id="first-invite-heading">Inviting is on hold</h2>
      <p>A refund was recorded before anyone was invited. Commons needs to review it with you. Your trip is saved and nothing has been sent.</p>
      <div className="setup-actions setup-actions--single">{keep}</div>
    </section>;
    case "payment_required":
    case "payment_processing": {
      if (waiting) return <section className="first-invite" aria-labelledby="first-invite-heading">
        <h2 id="first-invite-heading">Confirming your payment</h2>
        <p role="status">{confirmStalled ? "We haven’t received confirmation yet. It can take a little while. Nothing has been sent." : "Nothing has been sent."}</p>
        {errorLine}
        <div className="setup-actions">{keep}{confirmStalled ? <button type="button" onClick={() => { polls.current = 0; setConfirmStalled(false); void load(); }}>Check again</button> : null}</div>
      </section>;
      return <section className="first-invite" aria-labelledby="first-invite-heading">
        <h2 id="first-invite-heading">{forHelp ? "Upgrade this trip" : "We’re going"}</h2>
        {checkout === "cancelled" ? <p role="status">Checkout closed. No payment was recorded. Nothing has been sent.</p> : null}
        {status.failureCode === "async_failed" ? <p role="status">That payment didn’t go through. Nothing has been sent.</p> : null}
        {who}
        <p className="first-invite-lede">{forHelp ? "AI help building polls, for the whole trip." : "Invite everyone and start planning for real, with plans, costs and photos."}</p>
        <p className="first-invite-fee"><strong>{TRIP_FEE_LABEL}</strong><span>{TRIP_FEE_DETAIL}</span></p>
        {errorLine}
        <div className="setup-actions">{keep}<button type="button" disabled={busy} onClick={() => void pay()}>{busy ? "Opening checkout…" : "Pay $20"}</button></div>
      </section>;
    }
    default: {
      const count = people.length;
      return <section className="first-invite" aria-labelledby="first-invite-heading">
        <h2 id="first-invite-heading">{status.going ? "Ready to send." : status.state === "exempt" ? "Ready to go?" : "Paid. Are you going?"}</h2>
        {forHelp && !status.going ? <p><a href={doneHref(tripSlug ?? "")}>Back to your trip</a> to keep building polls. Say you’re going when you’re ready.</p> : null}
        {status.refundedCents > 0 ? <p role="status">A refund is on record. Everyone keeps their access. Check Money if it was shared with the group.</p> : null}
        {who}
        {errorLine}
        {count ? <div className="setup-actions">{keep}<button type="button" disabled={busy} onClick={() => void sendInvitations()}>{busy ? "Sending…" : `${status.going ? "Send" : "We’re going · Send"} ${count} invitation${count === 1 ? "" : "s"}`}</button></div> : !status.going && tripSlug ? <div className="setup-actions">{keep}<button type="button" disabled={busy} onClick={() => void declareGoing()}>{busy ? "Saving…" : "We’re going"}</button></div> : <div className="setup-actions setup-actions--single">{keep}</div>}
        {!count ? <p className="first-invite-note">Then add people from People. They’re invited as you add them.</p> : null}
      </section>;
    }
  }
}
