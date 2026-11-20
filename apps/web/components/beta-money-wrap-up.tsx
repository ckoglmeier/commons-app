"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CommonsSnapshotSchema, type CommonsState } from "@commons/contracts";
import { closureReadiness, moneyWrapUpRelevant, planNextVisible, type PaymentReportRow } from "../lib/beta/closure";
import { personFacingError } from "@/lib/person-facing-error";

type Person = { id: string; displayName: string };
type Report = PaymentReportRow & { note: string | null; createdAt: string };
type Recap = { status: "none" | "draft" | "shared"; summary: string; version: number; memories: { id: string; caption: string }[]; approvedAt: string | null };
type Source = { tripName: string; locationName: string | null; activities: { id: string; title: string }[]; stays: { id: string; name: string }[] };

const money = (cents: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const today = () => new Date().toISOString().slice(0, 10);

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers }, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "That didn’t work. Try again.");
  return payload as T;
}

/**
 * Money wrap-up (beta rework, BR-08): payment reports kept apart from recorded receipts, per-currency closure readiness, the recap, and a
 * quiet way to plan the next trip. Mounted under Money only when the server enables it. It changes no balance by itself: a report is a
 * claim, and only a recorded receipt settles anything.
 */
export function BetaMoneyWrapUp({ slug, currentActorId, isOrganizer, participants, state, moments, defaultCurrency, balancesDisabled, ledgerClosed, endsOn, features, onState }: {
  slug: string; currentActorId: string; isOrganizer: boolean; participants: Person[];
  state: Pick<CommonsState, "expenses" | "reimbursements">; moments: { id: string; caption: string }[];
  defaultCurrency: string; balancesDisabled: boolean; ledgerClosed: boolean; endsOn: string | null;
  features: { paymentReports: boolean; closure: boolean; recap: boolean; successor: boolean };
  onState: (state: CommonsState) => void;
}) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [problem, setProblem] = useState(""), [refresh, setRefresh] = useState(0);
  const reload = useCallback(async () => { setRefresh(count => count + 1); }, []);
  useEffect(() => {
    if (!features.paymentReports) return;
    let live = true;
    call<{ reports: Report[] }>(`/api/v1/commons/${slug}/payment-reports`)
      .then(result => { if (live) { setReports(result.reports); setProblem(""); } })
      .catch(error => { if (live) setProblem(personFacingError(error, "Payment reports didn’t load.")); });
    return () => { live = false; };
  }, [features.paymentReports, slug, refresh]);

  const nameOf = (id: string) => participants.find(person => person.id === id)?.displayName ?? "Someone";
  const readiness = useMemo(() => closureReadiness({ state, personIds: participants.map(person => person.id), balancesDisabled, reports: reports ?? [] }), [state, participants, balancesDisabled, reports]);
  const showNext = features.successor && planNextVisible({ endsOn, ledgerClosed, today: today(), isMember: participants.some(person => person.id === currentActorId) });

  // Nothing to pay back yet: Money stays about what was spent, with no forms ahead of the first shared expense.
  const moneyRelevant = moneyWrapUpRelevant({ reconciliation: readiness.reconciliation, reportCount: reports?.length ?? 0, reimbursementCount: state.reimbursements.length, ledgerClosed });
  const showRecap = features.recap && (ledgerClosed || showNext);
  if (!moneyRelevant && !showRecap && !showNext) return null;

  return <section className="beta-wrap" aria-labelledby="beta-wrap-title">
    <h2 id="beta-wrap-title">Payments and wrap-up</h2>
    {features.paymentReports && moneyRelevant ? <PaymentReports slug={slug} currentActorId={currentActorId} isOrganizer={isOrganizer} participants={participants} reports={reports} nameOf={nameOf}
      defaultCurrency={defaultCurrency} ledgerClosed={ledgerClosed} balancesDisabled={balancesDisabled} problem={problem} reload={reload} onState={onState} /> : null}
    {features.closure && !balancesDisabled && moneyRelevant ? <section className="beta-wrap__block" aria-labelledby="beta-closure-title">
      <h3 id="beta-closure-title">{ledgerClosed ? "What’s still open" : "Before closing the ledger"}</h3>
      {readiness.reconciliation.length === 0 ? <p>No shared expenses are recorded.</p> : <ul className="beta-wrap__list">
        {readiness.reconciliation.map(row => <li key={row.currency}>
          <strong>{row.currency}</strong>
          <span>{row.reconciled ? "Settled" : `${money(row.openCents, row.currency)} still to be paid back`}{row.pendingReports.length ? ` · ${row.pendingReports.length} reported, not recorded` : ""}</span>
        </li>)}
      </ul>}
      <p className="beta-wrap__meta">Each currency settles on its own. Commons doesn’t convert them, and a report doesn’t reduce what’s open. {ledgerClosed ? "The ledger is closed." : "An organizer closes the ledger once the group has added everything."}</p>
    </section> : null}
    {showRecap ? <RecapSection slug={slug} isOrganizer={isOrganizer} moments={moments} /> : null}
    {showNext ? <PlanNext slug={slug} /> : null}
  </section>;
}

function PaymentReports({ slug, currentActorId, isOrganizer, participants, reports, nameOf, defaultCurrency, ledgerClosed, balancesDisabled, problem, reload, onState }: {
  slug: string; currentActorId: string; isOrganizer: boolean; participants: Person[]; reports: Report[] | null; nameOf: (id: string) => string;
  defaultCurrency: string; ledgerClosed: boolean; balancesDisabled: boolean; problem: string; reload: () => Promise<void>; onState: (state: CommonsState) => void;
}) {
  const others = participants.filter(person => person.id !== currentActorId);
  const [to, setTo] = useState(""), [amount, setAmount] = useState(""), [currency, setCurrency] = useState(defaultCurrency), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [submitting, setSubmitting] = useState(false), [message, setMessage] = useState(""), [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [dates, setDates] = useState<Record<string, string>>({});
  const cents = Math.round(Number(amount.replace(/[$,\s]/g, "")) * 100);
  const valid = Boolean(to) && Number.isFinite(cents) && cents > 0 && /^[A-Za-z]{3}$/.test(currency);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setSubmitting(true); setMessage("");
    try {
      await call(`/api/v1/commons/${slug}/payment-reports`, { method: "POST", body: JSON.stringify({ commandId, toPersonId: to, currency: currency.toUpperCase(), amountCents: cents, note: note.trim() || null }) });
      setMessage(`Reported. ${nameOf(to)} or an organizer records it. Your balance changes only then.`);
      setAmount(""); setNote(""); setCommandId(crypto.randomUUID());
      await reload();
    } catch (error) { setMessage(personFacingError(error, "Report not saved. Try again.")); }
    finally { setBusy(false); setSubmitting(false); }
  }
  async function resolve(report: Report, action: "record" | "dismiss") {
    setBusy(true); setMessage("");
    try {
      const result = await call<{ snapshot?: unknown }>(`/api/v1/commons/${slug}/payment-reports/${report.id}`, { method: "POST", body: JSON.stringify({ action, occurredOn: dates[report.id] || today() }) });
      if (result.snapshot) onState(CommonsSnapshotSchema.parse(result.snapshot).state);
      setMessage(action === "record" ? `Payment from ${nameOf(report.reportedByPersonId)} recorded.` : "Report dismissed. Nothing was recorded.");
      await reload();
    } catch (error) { setMessage(personFacingError(error, "That didn’t work. Try again.")); }
    finally { setBusy(false); }
  }

  const open = (reports ?? []).filter(report => report.status === "reported");
  const past = (reports ?? []).filter(report => report.status !== "reported").slice(0, 5);
  return <section className="beta-wrap__block" aria-labelledby="beta-paid-title">
    <h3 id="beta-paid-title">Payments between people</h3>
    {balancesDisabled ? <p>This trip tracks spending without balances, so there’s nothing to pay back.</p> : ledgerClosed ? <p>The ledger is closed. An organizer can reopen it to record another payment.</p> : <details className="beta-wrap__report"><summary>I paid someone</summary><form className="beta-wrap__form" onSubmit={submit}>
      <p className="beta-wrap__meta">Tell the person you paid. This doesn’t change anyone’s balance until they record it.</p>
      <label>Who you paid
        <select value={to} onChange={event => setTo(event.target.value)} required>
          <option value="">Choose a person</option>
          {others.map(person => <option key={person.id} value={person.id}>{person.displayName}</option>)}
        </select>
      </label>
      <div className="beta-wrap__row">
        <label>Amount<input inputMode="decimal" autoComplete="off" value={amount} onChange={event => setAmount(event.target.value)} placeholder="84.00" required /></label>
        <label>Currency<input value={currency} maxLength={3} autoCapitalize="characters" onChange={event => setCurrency(event.target.value.toUpperCase())} required /></label>
      </div>
      <label>Note · optional<input value={note} maxLength={200} onChange={event => setNote(event.target.value)} placeholder="Bank transfer on Friday" /></label>
      <button type="submit" className="cm-action cm-action--primary" disabled={!valid || busy}>{submitting ? "Saving…" : "Report payment"}</button>
    </form></details>}
    <p className="beta-wrap__status" role="status">{message || problem}</p>
    {open.length ? <ul className="beta-wrap__list" aria-label="Reported payments">
      {open.map(report => {
        const canRecord = isOrganizer || report.toPersonId === currentActorId;
        const mine = report.reportedByPersonId === currentActorId;
        return <li key={report.id}>
          <span><strong>{money(report.amountCents, report.currency)}</strong> from {nameOf(report.reportedByPersonId)} to {nameOf(report.toPersonId)}<small> · Reported, not recorded{report.note ? ` · ${report.note}` : ""}</small></span>
          <span className="beta-wrap__actions">
            {canRecord && !ledgerClosed ? <>
              <label className="beta-wrap__date">Received on<input type="date" value={dates[report.id] ?? today()} onChange={event => setDates(current => ({ ...current, [report.id]: event.target.value }))} /></label>
              <button type="button" className="cm-action cm-action--primary" disabled={busy} onClick={() => void resolve(report, "record")}>Record payment</button>
            </> : null}
            {canRecord || mine ? <button type="button" className="cm-action" disabled={busy} onClick={() => void resolve(report, "dismiss")}>{mine && !canRecord ? "Withdraw report" : "Dismiss"}</button> : null}
          </span>
        </li>;
      })}
    </ul> : reports && !balancesDisabled ? <p className="beta-wrap__meta">No payments are waiting to be recorded.</p> : null}
    {past.length ? <details className="beta-wrap__history"><summary>Earlier reports ({past.length})</summary><ul className="beta-wrap__list">
      {past.map(report => <li key={report.id}><span>{money(report.amountCents, report.currency)} from {nameOf(report.reportedByPersonId)} to {nameOf(report.toPersonId)}</span><span>{report.status === "recorded" ? "Recorded" : "Dismissed"}</span></li>)}
    </ul></details> : null}
  </section>;
}

function RecapSection({ slug, isOrganizer, moments }: { slug: string; isOrganizer: boolean; moments: { id: string; caption: string }[] }) {
  const [recap, setRecap] = useState<Recap | null>(null);
  const [summary, setSummary] = useState(""), [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    call<{ recap: Recap }>(`/api/v1/commons/${slug}/recap`).then(({ recap: next }) => { if (!live) return; setRecap(next); setSummary(next.summary); setChosen(next.memories.map(memory => memory.id)); }).catch(() => { if (live) setMessage("The recap didn’t load."); });
    return () => { live = false; };
  }, [slug]);
  async function save(share: boolean) {
    if (!recap) return;
    setBusy(true); setMessage("");
    try {
      const next = (await call<{ recap: Recap }>(`/api/v1/commons/${slug}/recap`, { method: "PUT", body: JSON.stringify({ expectedVersion: recap.version, summary, approvedMomentIds: chosen, share }) })).recap;
      setRecap(next); setMessage(share ? "Recap shared with the group." : recap.status === "shared" ? "Draft saved. The group no longer sees the recap until you share it again." : "Draft saved. Only organizers can see it.");
    } catch (error) { setMessage(personFacingError(error, "Recap not saved. Try again.")); }
    finally { setBusy(false); }
  }
  if (!recap) return message ? <p className="beta-wrap__status" role="status">{message}</p> : null;
  if (!isOrganizer) return recap.status === "shared" ? <section className="beta-wrap__block" aria-labelledby="beta-recap-title">
    <h3 id="beta-recap-title">Trip recap</h3>
    <p className="beta-wrap__recap">{recap.summary}</p>
    {recap.memories.length ? <ul className="beta-wrap__list">{recap.memories.map(memory => <li key={memory.id}>{memory.caption}</li>)}</ul> : null}
  </section> : null;
  return <section className="beta-wrap__block" aria-labelledby="beta-recap-title">
    <h3 id="beta-recap-title">Trip recap</h3>
    <p className="beta-wrap__meta">{recap.status === "shared" ? "Shared with the group. Share recap again to update what they see. Save draft hides it from the group until you share it again." : "Draft. Only organizers can see it until you share it."}</p>
    <label className="beta-wrap__field">What to remember<textarea value={summary} maxLength={1200} rows={4} onChange={event => setSummary(event.target.value)} /></label>
    {moments.length ? <fieldset className="beta-wrap__choices"><legend>Photos to include</legend>
      {moments.slice(0, 24).map(moment => <label key={moment.id}><input type="checkbox" checked={chosen.includes(moment.id)} onChange={event => setChosen(current => event.target.checked ? [...current, moment.id] : current.filter(id => id !== moment.id))} /> {moment.caption || "Untitled photo"}</label>)}
    </fieldset> : <p className="beta-wrap__meta">No photos yet. Add some from Photos to include them.</p>}
    <div className="beta-wrap__actions">
      <button type="button" className="cm-action" disabled={busy} onClick={() => void save(false)}>Save draft</button>
      <button type="button" className="cm-action cm-action--primary" disabled={busy || summary.trim().length === 0} onClick={() => void save(true)}>Share recap</button>
    </div>
    <p className="beta-wrap__status" role="status">{message}</p>
  </section>;
}

function PlanNext({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [source, setSource] = useState<Source | null>(null);
  const [activities, setActivities] = useState<string[]>([]), [stays, setStays] = useState<string[]>([]);
  const [keepDestination, setKeepDestination] = useState(false), [includePeople, setIncludePeople] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [commandId] = useState(() => crypto.randomUUID());
  async function expand() {
    setOpen(true);
    if (source) return;
    try { setSource((await call<{ source: Source }>(`/api/v1/commons/${slug}/next-trip`)).source); }
    catch (error) { setMessage(personFacingError(error, "This trip’s ideas didn’t load.")); }
  }
  async function start() {
    setBusy(true); setMessage("");
    try {
      const result = await call<{ path: string }>(`/api/v1/commons/${slug}/next-trip`, { method: "POST", body: JSON.stringify({ commandId, activityIds: activities, stayIds: stays, keepDestination, includePeople, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
      router.push(result.path);
    } catch (error) { setMessage(personFacingError(error, "The draft wasn’t started. Try again.")); setBusy(false); }
  }
  const toggle = (list: string[], set: (next: string[]) => void, id: string, on: boolean) => set(on ? [...list, id] : list.filter(value => value !== id));
  return <section className="beta-wrap__block beta-wrap__next" aria-labelledby="beta-next-title">
    <h3 id="beta-next-title">Plan the next one</h3>
    {!open ? <button type="button" className="cm-action" onClick={() => void expand()}>Start a private draft</button> : <>
      <p className="beta-wrap__meta">This starts a private draft you can edit. Nothing is sent or charged. Dates, votes, attendance, bookings, payments and messages don’t carry over.</p>
      {source ? <>
        {source.locationName ? <label className="beta-wrap__check"><input type="checkbox" checked={keepDestination} onChange={event => setKeepDestination(event.target.checked)} /> Suggest {source.locationName} again</label> : null}
        {source.activities.length ? <fieldset className="beta-wrap__choices"><legend>Ideas to think about again</legend>
          {source.activities.map(item => <label key={item.id}><input type="checkbox" checked={activities.includes(item.id)} onChange={event => toggle(activities, setActivities, item.id, event.target.checked)} /> {item.title}</label>)}
        </fieldset> : null}
        {source.stays.length ? <fieldset className="beta-wrap__choices"><legend>Places to stay</legend>
          {source.stays.map(item => <label key={item.id}><input type="checkbox" checked={stays.includes(item.id)} onChange={event => toggle(stays, setStays, item.id, event.target.checked)} /> {item.name}</label>)}
        </fieldset> : null}
        <label className="beta-wrap__check"><input type="checkbox" checked={includePeople} onChange={event => setIncludePeople(event.target.checked)} /> Start with the same people to review. No one is invited until you send invitations.</label>
        <div className="beta-wrap__actions"><button type="button" className="cm-action cm-action--primary" disabled={busy} onClick={() => void start()}>{busy ? "Starting…" : "Start the draft"}</button>
          <button type="button" className="cm-action" disabled={busy} onClick={() => setOpen(false)}>Not now</button></div>
      </> : <p className="beta-wrap__meta">Loading this trip’s ideas…</p>}
      <p className="beta-wrap__status" role="status">{message}</p>
    </>}
  </section>;
}
