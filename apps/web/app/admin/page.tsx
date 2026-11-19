import { CommonsWordmark } from "@commons/ui";
import { CONVERSATION_DIGEST_MAX_ATTEMPTS } from "@commons/database";
import Link from "next/link";
import { commonsPath } from "@/lib/commons-route";
import { notFound } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { BetaInviteForm } from "./beta-invite-form";
import { WritingSmokeForm } from "./writing-smoke-form";
import { getCurrentAccountInitials, getCurrentCommonsIdentity } from "@/lib/server/commons";
import { CommonsOperatorRequiredError, loadOperatorOverview } from "@/lib/server/operator";
import { betaApprovalEmailEnabled } from "@/lib/server/beta-approval-delivery";
import { betaActivationEnabled } from "@/lib/trip-activation/provider";
import {
  approveCreationAccess,
  revokeBetaInvite,
  retryApprovalNotice,
  retryDailyEmail,
  retryInvitation,
  revokeCreationAccess,
} from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

function accessLabel(status: string | null) {
  if (status === "approved") return "Can create events";
  if (status === "requested") return "Access requested";
  if (status === "revoked") return "Access revoked";
  return "No creation access";
}

function time(value: Date | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(value);
}

function dailyEmailStatus(delivery: {
  status: string;
  attempts: number;
  availableAt: Date;
  leaseExpiresAt: Date | null;
  errorCode: string | null;
}) {
  if (delivery.status === "queued") return "Queued for the next delivery run";
  if (delivery.status === "leased") {
    if (delivery.leaseExpiresAt && delivery.leaseExpiresAt <= new Date()) {
      return "Sending was interrupted";
    }
    return "Sending now";
  }
  if (delivery.status === "failed" && delivery.attempts >= CONVERSATION_DIGEST_MAX_ATTEMPTS) {
    return `Failed after ${delivery.attempts} attempts`;
  }
  if (delivery.status === "failed") return `Retry scheduled ${time(delivery.availableAt)}`;
  return delivery.errorCode?.replaceAll("_", " ") ?? delivery.status.replaceAll("_", " ");
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const identity = await getCurrentCommonsIdentity();
  if (!identity) notFound();
  const queryValue = (await searchParams).q;
  const query = (Array.isArray(queryValue) ? queryValue[0] : queryValue)?.trim() ?? "";
  let overview: Awaited<ReturnType<typeof loadOperatorOverview>>;
  try { overview = await loadOperatorOverview(query); }
  catch (error) { if (error instanceof CommonsOperatorRequiredError) notFound(); throw error; }
  const activationOn = betaActivationEnabled();
  const approvalEmailOn = activationOn && betaApprovalEmailEnabled();
  const initials = await getCurrentAccountInitials(identity);
  const pending = overview.access.filter((row) => row.status === "requested");
  const decided = overview.access.filter((row) => row.status !== "requested");
  const attention = overview.invitations.filter((row) => row.invitationStatus === "pending" && row.deliveryState !== "sent");
  const digestAttention = overview.digests.filter((row) => row.status !== "sent");
  const digestNeedsRecovery = digestAttention.filter((row) =>
    (row.status === "failed" && row.attempts >= CONVERSATION_DIGEST_MAX_ATTEMPTS)
    || (row.status === "leased"
      && row.attempts >= CONVERSATION_DIGEST_MAX_ATTEMPTS
      && row.leaseExpiresAt !== null
      && row.leaseExpiresAt <= new Date()),
  );
  const recentDigests = overview.digests.filter((row) => row.status === "sent");
  const ambiguousNameSearch = query.length >= 2 && !query.includes("@") && overview.accounts.length > 1;

  return <main className="operator-shell">
    <header className="creation-header"><Link className="entry-brand" href="/"><CommonsWordmark /></Link><div className="event-creation-nav"><Link href="/trips">Your events</Link><AccountMenu initials={initials} canSignOut operator /></div></header>
    <div className="operator-content">
      <header className="operator-intro"><span className="view-kicker">Pilot admin</span><h1>Access and delivery</h1><p>Manage event creation and recover invitation or daily email delivery without opening event content.</p></header>
      {!overview.email.configured ? <section className="operator-warning" role="status"><strong>Email delivery is not configured.</strong><p>Private links still work. Add {overview.email.missing.join(", ")} in production before relying on invitation email.</p></section> : null}
      {!overview.email.digestsEnabled ? <section className="operator-warning" role="status"><strong>Daily emails are paused.</strong><p>Messages and expenses remain safe. Enable the digest worker before relying on email to bring people back.</p></section> : null}
      {activationOn ? <section className="operator-section"><div className="operator-heading"><div><h2>Payments &amp; refunds</h2><p>Trip fees, tax and ledger review</p></div></div><div className="operator-row"><div><strong>Review trip payments</strong><span>Read payment evidence and refunds. Nothing here moves money.</span></div><Link href="/admin/payments">View payments</Link></div><div className="operator-row"><div><strong>Beta operations</strong><span>Delivery failures, partner inquiries, attribution and usage limits.</span></div><Link href="/admin/beta">View operations</Link></div></section> : null}
      <section className="operator-section"><div className="operator-heading"><div><h2>Workflows</h2><p>Versioned instructions for poll and itinerary drafts</p></div></div><div className="operator-row"><div><strong>Improve the drafting paths</strong><span>Existing drafts keep their template version.</span></div><Link href="/admin/workflows">Edit workflows</Link></div></section>
      <section className="operator-section"><div className="operator-heading"><div><h2>Writing comparison</h2><p>Private provider smoke</p></div></div><WritingSmokeForm /></section>
      <section className="operator-section"><div className="operator-heading"><h2>Invite a beta organizer</h2></div>
        <BetaInviteForm enabled={overview.email.configured} />
        {overview.betaInvites.length ? <details className="operator-history"><summary>Beta invitations ({overview.betaInvites.length})</summary><div className="operator-list">{overview.betaInvites.map(invite => <article className="operator-row" key={invite.id}><div><strong>{invite.email}</strong><span>{invite.revokedAt ? "Revoked" : invite.claimedByPersonId ? "Claimed · See account access below" : invite.sentAt ? "Email sent · Awaiting sign-in" : "Access saved · Email not confirmed"}</span></div>{!invite.revokedAt ? <form action={revokeBetaInvite}><input type="hidden" name="inviteId" value={invite.id} /><button className="secondary" type="submit">Revoke access</button></form> : null}</article>)}</div></details> : null}
      </section>
      <section className="operator-section"><div className="operator-heading"><div><h2>Find an account</h2><p>Search by name or exact email</p></div></div>
        <form className="operator-search" action="/admin" method="get" role="search">
          <label htmlFor="operator-account-query">Name or email</label>
          <div><input id="operator-account-query" name="q" type="search" minLength={2} defaultValue={query} required /><button type="submit">Search</button></div>
        </form>
        {query.length >= 2 ? <div className="operator-list operator-search-results">
          {overview.accounts.length ? overview.accounts.map((row) => {
            const canChange = !ambiguousNameSearch && Boolean(row.email);
            return <article className="operator-row" key={row.personId}><div><strong>{row.displayName}</strong><span>{row.email ?? "Email unavailable"}</span><small>{accessLabel(row.accessStatus)}</small></div>{canChange ? row.accessStatus === "approved" ? <form action={revokeCreationAccess}><input type="hidden" name="personId" value={row.personId} /><button className="secondary" type="submit">Revoke</button></form> : <form action={approveCreationAccess}><input type="hidden" name="personId" value={row.personId} /><input type="hidden" name="requesterEmail" value={row.email ?? ""} /><button type="submit">{row.accessStatus === "revoked" ? "Restore" : "Grant access"}</button></form> : null}</article>;
          }) : <p className="operator-empty">No claimed account found.</p>}
        </div> : null}
        {ambiguousNameSearch ? <p className="operator-search-note" role="status">More than one account matched. Search the exact email to change access.</p> : null}
      </section>
      <section className="operator-section"><div className="operator-heading"><div><h2>{activationOn ? "Beta approval requests" : "Creation requests"}</h2><p>{pending.length ? `${pending.length} waiting` : "Nothing waiting"}</p></div></div>
        <div className="operator-list">{pending.length ? pending.map((row) => <article className="operator-row" key={row.personId}><div><strong>{row.requesterEmail}</strong><span>Requested {time(row.requestedAt)}</span>{activationOn && row.resumeDraftId ? <small>Saved trip to return to{row.entryContext ? ` · ${[row.entryContext.source, row.entryContext.template, row.entryContext.destination].filter(Boolean).join(" · ") || "direct"}` : ""}</small> : null}</div><form action={approveCreationAccess}><input type="hidden" name="personId" value={row.personId} /><button type="submit">Approve</button></form></article>) : <p className="operator-empty">New access requests will appear here.</p>}</div>
        {decided.length ? <details className="operator-history"><summary>Approved and revoked ({decided.length})</summary><div className="operator-list">{decided.map((row) => <article className="operator-row" key={row.personId}><div><strong>{row.requesterEmail}</strong><span>{row.status === "approved" ? (activationOn ? (row.grantsPilotCapabilities ? "Can create events · pilot access" : "Can invite their group") : "Can create events") : "Access revoked"}</span>{activationOn && row.status === "approved" && !row.grantsPilotCapabilities ? <small>Approval email: {row.approvalNoticeStatus === "sent" ? "sent" : row.approvalNoticeStatus === "retry_pending" ? "not confirmed" : row.approvalNoticeStatus === "sending" ? "sending" : "not sent"}</small> : null}{activationOn && row.status === "approved" && !row.grantsPilotCapabilities && approvalEmailOn && row.approvalNoticeStatus !== "sent" ? <form action={retryApprovalNotice}><input type="hidden" name="personId" value={row.personId} /><button className="secondary" type="submit">Retry approval email</button></form> : null}</div>{row.status === "approved" ? <form action={revokeCreationAccess}><input type="hidden" name="personId" value={row.personId} /><button className="secondary" type="submit">Revoke</button></form> : <form action={approveCreationAccess}><input type="hidden" name="personId" value={row.personId} /><button className="secondary" type="submit">Restore</button></form>}</article>)}</div></details> : null}
      </section>
      <section className="operator-section"><div className="operator-heading"><div><h2>Invitations needing attention</h2><p>{attention.length ? `${attention.length} pending` : "All clear"}</p></div></div>
        <div className="operator-list">{attention.length ? attention.map((row) => <article className="operator-row operator-row--invitation" key={row.invitationId}><div><strong>{row.recipientName}</strong><span>{row.recipientEmail ?? "No email"} · {row.eventName}</span><small>{row.deliveryState.replaceAll("_", " ")}{row.deliveryErrorCode ? ` · ${row.deliveryErrorCode.replaceAll("_", " ")}` : ""} · last attempt {time(row.lastAttemptAt)}</small></div>{row.recipientEmail ? <form action={retryInvitation}><input type="hidden" name="invitationId" value={row.invitationId} /><button type="submit" disabled={!overview.email.configured}>Retry email</button></form> : <Link href={commonsPath(row.eventId)}>Open event</Link>}</article>) : <p className="operator-empty">No pending invitation emails need recovery.</p>}</div>
      </section>
      <section className="operator-section"><div className="operator-heading"><div><h2>Daily emails</h2><p>{digestNeedsRecovery.length ? `${digestNeedsRecovery.length} need attention` : digestAttention.length ? `${digestAttention.length} queued or retrying` : "All clear"}</p></div></div>
        <div className="operator-list">{digestAttention.length ? digestAttention.map((row) => {
          const interrupted = row.status === "leased" && row.leaseExpiresAt !== null && row.leaseExpiresAt <= new Date();
          const canRetry = row.status === "failed" || interrupted;
          return <article className="operator-row operator-row--invitation" key={row.id}><div><strong>{row.recipientName}</strong><span>{row.eventCount} {row.eventCount === 1 ? "event" : "events"} · {row.periodKey}</span><small>{dailyEmailStatus(row)}{row.errorCode ? ` · ${row.errorCode.replaceAll("_", " ")}` : ""}</small></div>{canRetry ? <form action={retryDailyEmail}><input type="hidden" name="deliveryId" value={row.id} /><button type="submit" disabled={!overview.email.configured}>Retry email</button></form> : null}</article>;
        }) : <p className="operator-empty">No daily emails need recovery.</p>}</div>
        {recentDigests.length ? <details className="operator-history"><summary>Recent deliveries ({recentDigests.length})</summary><div className="operator-list">{recentDigests.map((row) => <article className="operator-row" key={row.id}><div><strong>{row.recipientName}</strong><span>{row.eventCount} {row.eventCount === 1 ? "event" : "events"} · {row.periodKey}</span><small>Sent {time(row.sentAt)} · {row.attempts} {row.attempts === 1 ? "attempt" : "attempts"}</small></div></article>)}</div></details> : null}
      </section>
    </div>
  </main>;
}
