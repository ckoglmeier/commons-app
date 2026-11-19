import { CommonsWordmark } from "@commons/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { ENFORCED_USAGE_KINDS, USAGE_LABELS, type UsageKind } from "@/lib/beta/usage";
import { BetaDisabledError, loadBetaOperatorOverview, loadTripUsage } from "@/lib/server/beta-completion";
import { getCurrentAccountInitials, getCurrentCommonsIdentity } from "@/lib/server/commons";
import { CommonsOperatorRequiredError } from "@/lib/server/operator";
import { readHourlyTraffic, UNKNOWN_SEND_OUTCOME } from "@commons/database";
import { breachedSignals, TRAFFIC_LABELS, TRAFFIC_SIGNALS, trafficAlertLevels } from "@/lib/beta/traffic";
import { publicPollsPaused } from "@/lib/beta/flags";
import { commonsDatabaseUrl, readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";
import { markFailure, retryFailure, retryMessage, saveUsageControl } from "./actions";

export const dynamic = "force-dynamic";

const time = (value: Date | null) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(value) : "Not yet";
const STATE_LABEL = { open: "Open", reviewed: "Reviewed, not resolved", resolved: "Resolved" } as const;

function Actions({ kind, id, state, retryable }: { kind: string; id: string; state: keyof typeof STATE_LABEL; retryable: boolean }) {
  return <div className="operator-actions">
    {retryable && state !== "resolved" ? <form action={retryFailure}><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><button type="submit">Retry</button></form> : null}
    {state === "open" ? <form action={markFailure}><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="action" value="reviewed" /><button className="secondary" type="submit">Mark reviewed</button></form> : null}
    {state !== "resolved" ? <form action={markFailure}><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="action" value="resolved" /><button className="secondary" type="submit">Mark resolved</button></form>
      : <form action={markFailure}><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="action" value="reopened" /><button className="secondary" type="submit">Reopen</button></form>}
  </div>;
}

export default async function BetaAdminPage({ searchParams }: { searchParams: Promise<{ trip?: string | string[] }> }) {
  const identity = await getCurrentCommonsIdentity();
  if (!identity) notFound();
  const tripValue = (await searchParams).trip;
  const trip = (Array.isArray(tripValue) ? tripValue[0] : tripValue)?.trim() ?? "";
  let overview: Awaited<ReturnType<typeof loadBetaOperatorOverview>>;
  let traffic: Awaited<ReturnType<typeof readHourlyTraffic>> = [];
  const trafficLevels = trafficAlertLevels(readCommonsRuntimeEnvironment() as unknown as Record<string, unknown>);
  let usage: Awaited<ReturnType<typeof loadTripUsage>> = null;
  try {
    overview = await loadBetaOperatorOverview();
    traffic = await readHourlyTraffic(24, commonsDatabaseUrl() ?? undefined);
    if (trip) usage = await loadTripUsage(trip);
  } catch (error) {
    if (error instanceof CommonsOperatorRequiredError || error instanceof BetaDisabledError) notFound();
    throw error;
  }
  const initials = await getCurrentAccountInitials(identity);
  const openFailures = overview.failures.filter(item => item.state !== "resolved");

  return <main className="operator-shell">
    <header className="creation-header"><Link className="entry-brand" href="/"><CommonsWordmark /></Link><div className="event-creation-nav"><Link href="/admin">Pilot admin</Link><AccountMenu initials={initials} canSignOut operator /></div></header>
    <div className="operator-content">
      <header className="operator-intro"><span className="view-kicker">Beta admin</span><h1>Inquiries, failures and limits</h1><p>See what needs attention without opening trip content. Every action here is recorded.</p></header>
      {!overview.routeConfigured ? <section className="operator-warning" role="status"><strong>Partner inquiries are not routed.</strong><p>They are saved here. Set COMMONS_PARTNER_INQUIRY_ROUTE_EMAIL to send them to an address, then use Retry on each one.</p></section> : null}
      {overview.killSwitches.length ? <section className="operator-warning" role="status"><strong>Kill switches are on.</strong><p>{overview.killSwitches.join(", ")}</p></section> : null}

      <section className="operator-section"><div className="operator-heading"><div><h2>Needs attention</h2><p>{openFailures.length ? `${openFailures.length} open` : "All clear"}</p></div></div>
        <div className="operator-list">{overview.failures.length ? overview.failures.map(item => <article className="operator-row operator-row--invitation" key={`${item.kind}:${item.id}`}>
          <div><strong>{item.summary}</strong><span>{item.detail}</span><small>{STATE_LABEL[item.state]} · {item.attempts} {item.attempts === 1 ? "attempt" : "attempts"} · {time(item.occurredAt)}</small></div>
          <Actions kind={item.kind} id={item.id} state={item.state} retryable={item.retryable} />
        </article>) : <p className="operator-empty">No delivery or intake failures in the last 7 days.</p>}</div>
      </section>

      <section className="operator-section"><div className="operator-heading"><div><h2>Traffic</h2><p>Last 24 hours, UTC. Alert levels: {TRAFFIC_SIGNALS.map(signal => `${TRAFFIC_LABELS[signal]} ${trafficLevels[signal]}/hour`).join(" · ")}</p></div></div>
        {publicPollsPaused() ? <p className="operator-warning" role="status">Link polls and answers are paused.</p> : null}
        {traffic.length ? <div className="operator-list">{traffic.map(row => { const over = breachedSignals(row, trafficLevels); return <article className="operator-row" key={row.hour}>
          <div><strong>{row.hour.slice(5, 16).replace("T", " ")}{over.length ? " · Over the alert level" : ""}</strong><span>{TRAFFIC_SIGNALS.map(signal => `${row[signal]} ${TRAFFIC_LABELS[signal]}`).join(" · ")}</span></div>
        </article>; })}</div> : <p className="operator-empty">No activity in the last 24 hours.</p>}
      </section>

      <section className="operator-section"><div className="operator-heading"><div><h2>Text messages</h2><p>{overview.messaging.failures.length ? `${overview.messaging.failures.length} not delivered` : "None failed"} · {overview.messaging.stuckQueued} waiting too long · {overview.messaging.unprocessedInbound} replies not yet handled</p></div></div>
        <div className="operator-list">{overview.messaging.failures.map(item => <article className="operator-row operator-row--invitation" key={item.id}>
          <div><strong>{item.purpose}</strong><span>{item.status}{item.detail ? ` · ${item.detail}` : ""}</span><small>{item.attempts} {item.attempts === 1 ? "attempt" : "attempts"} · {time(item.at)}</small></div>
          <form action={retryMessage}><input type="hidden" name="id" value={item.id} />{item.detail === UNKNOWN_SEND_OUTCOME ? <><p>This may have been delivered. Check the provider first.</p><input type="hidden" name="checkedProvider" value="yes" /><button type="submit">I checked. Retry</button></> : <button type="submit">Retry</button>}</form>
        </article>)}</div>
      </section>

      <section className="operator-section"><div className="operator-heading"><div><h2>Partner inquiries</h2><p>{overview.inquiries.length} recent</p></div></div>
        <div className="operator-list">{overview.inquiries.length ? overview.inquiries.map(row => <article className="operator-row operator-row--invitation" key={row.id}>
          <div><strong>{row.organization}</strong><span>{row.kind === "dmo" ? "Destination organization" : "Travel assistant"} · {row.contactName} · {row.contactEmail}{row.region ? ` · ${row.region}` : ""}</span>
            <small>{STATE_LABEL[row.state]} · Delivery: {row.deliveryStatus.replaceAll("_", " ")}{row.deliveryErrorCode ? ` (${row.deliveryErrorCode.replaceAll("_", " ")})` : ""} · {time(row.createdAt)} · from {row.sourcePath}</small>
            <details><summary>Message</summary><p className="operator-message">{row.message}</p></details></div>
          <Actions kind="partner_inquiry" id={row.id} state={row.state} retryable={row.deliveryStatus === "failed" || row.deliveryStatus === "not_routed"} />
        </article>) : <p className="operator-empty">Inquiries from the partner and destination pages appear here.</p>}</div>
      </section>

      <section className="operator-section"><div className="operator-heading"><div><h2>Attribution, last 30 days</h2><p>Counts only. No people, contacts or text.</p></div></div>
        <div className="operator-list">{overview.attribution.length ? overview.attribution.map(row => <article className="operator-row" key={`${row.event}:${row.entryKind}`}><div><strong>{row.event.replaceAll("_", " ")}</strong><span>{row.entryKind}</span></div><span>{Number(row.total)}</span></article>) : <p className="operator-empty">No attribution events yet.</p>}</div>
      </section>

      <section className="operator-section"><div className="operator-heading"><div><h2>Trip usage and limits</h2><p>Rolling 30 days. Bounds are safety limits, not a budget.</p></div></div>
        <form className="operator-search" action="/admin/beta" method="get" role="search"><label htmlFor="usage-trip">Trip address</label><div><input id="usage-trip" name="trip" defaultValue={trip} placeholder="trip-address" required /><button type="submit">Show usage</button></div></form>
        {trip && !usage ? <p className="operator-empty">No trip has that address.</p> : null}
        {usage ? <div className="operator-list">{usage.rows.filter(row => ENFORCED_USAGE_KINDS.includes(row.kind as UsageKind)).map(row => <article className="operator-row operator-row--invitation" key={row.kind}>
          <div><strong>{USAGE_LABELS[row.kind as UsageKind]}</strong><span>{row.used} used · limit {row.limit ?? "none (measured only)"}{row.disabled ? " · Stopped for this trip" : ""}</span>{row.costMicros ? <small>Recorded cost ${(row.costMicros / 1_000_000).toFixed(2)}</small> : null}</div>
          <form action={saveUsageControl} className="operator-actions">
            <input type="hidden" name="slug" value={trip} /><input type="hidden" name="kind" value={row.kind} />
            <label>Limit<input name="limit" inputMode="numeric" defaultValue={row.customized ? row.limit ?? "" : ""} placeholder="default" /></label>
            <label className="operator-check"><input type="checkbox" name="disabled" defaultChecked={row.disabled} /> Stop</label>
            <button type="submit">Save</button>
          </form>
        </article>)}</div> : null}
      </section>
    </div>
  </main>;
}
