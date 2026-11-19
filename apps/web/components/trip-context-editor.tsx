"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { currencyLabel, currencySymbol, SaveTripPlanningContextSchema, TripPlanningContextStateSchema, type TripPlanningContextState } from "@commons/contracts";

const DraftSchema = z.object({ summary: z.string(), pace: z.string(), goals: z.string(), constraints: z.string(), minimum: z.string(), maximum: z.string(), currency: z.string() });
const StoredSchema = z.object({ draft: DraftSchema, version: z.number().int().nonnegative(), pending: SaveTripPlanningContextSchema.nullable() });
type Draft = z.infer<typeof DraftSchema>;
const draftFor = ({ brief, defaultCurrency }: TripPlanningContextState): Draft => ({ summary: brief.summary ?? "", pace: brief.pace ?? "", goals: brief.goals.join("\n"), constraints: brief.constraints.join("\n"), minimum: brief.budgetMinimumCents === null ? "" : (brief.budgetMinimumCents / 100).toFixed(2), maximum: brief.budgetMaximumCents === null ? "" : (brief.budgetMaximumCents / 100).toFixed(2), currency: brief.currency ?? defaultCurrency });
const amount = (text: string) => !text.trim() ? null : /^\d+(\.\d{0,2})?$/.test(text.trim()) ? Math.round(Number(text) * 100) : NaN;
export function TripContextEditor({ initial }: { initial: TripPlanningContextState }) {
  const key = `commons:trip-context:${initial.tripId}:${initial.viewerId}`;
  const [saved, setSaved] = useState(initial), [draft, setDraft] = useState(() => draftFor(initial));
  const [version, setVersion] = useState(initial.version), [pending, setPending] = useState<z.infer<typeof SaveTripPlanningContextSchema> | null>(null);
  const [ready, setReady] = useState(false), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [latest, setLatest] = useState<TripPlanningContextState | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
    try {
      const raw = sessionStorage.getItem(key);
      const stored = raw ? StoredSchema.safeParse(JSON.parse(raw)) : null;
      if (stored?.success) {
        setDraft(stored.data.draft); setVersion(stored.data.version); setPending(stored.data.pending); setDirty(true); setNotice("Unsaved edits restored.");
      }
    } catch { /* Storage may be unavailable; editing still works. */ }
    setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    try { if (dirty || pending) sessionStorage.setItem(key, JSON.stringify({ draft, version, pending })); else sessionStorage.removeItem(key); } catch { /* Save remains usable. */ }
  }, [key, ready, dirty, draft, version, pending]);
  function change(field: keyof Draft, value: string) { setDraft(current => ({ ...current, [field]: value })); setDirty(true); setNotice(""); }
  async function save() {
    const parsed = SaveTripPlanningContextSchema.safeParse(pending ?? { commandId: crypto.randomUUID(), expectedVersion: version, brief: {
      summary: draft.summary.trim() || null, pace: draft.pace.trim() || null,
      goals: draft.goals.split("\n").map(value => value.trim()).filter(Boolean), constraints: draft.constraints.split("\n").map(value => value.trim()).filter(Boolean),
      budgetMinimumCents: amount(draft.minimum), budgetMaximumCents: amount(draft.maximum), currency: draft.minimum.trim() || draft.maximum.trim() ? draft.currency : null,
    } });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the context fields."); return; }
    setBusy(true); setError(""); setPending(parsed.data);
    // Persist the request before sending, so a reload can safely retry an uncertain save.
    try { sessionStorage.setItem(key, JSON.stringify({ draft, version, pending: parsed.data })); } catch { /* The mounted retry still reuses this command. */ }
    try {
      const response = await fetch(`/api/v1/commons/${initial.tripId}/context`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data) });
      const body = await response.json();
      if (!response.ok) {
        if (response.status < 500) setPending(null);
        if (response.status === 409) {
          const fresh = await fetch(`/api/v1/commons/${initial.tripId}/context`, { cache: "no-store" });
          if (fresh.ok) setLatest(TripPlanningContextStateSchema.parse(await fresh.json()));
        }
        throw new Error(body.error ?? "Trip context could not be saved.");
      }
      const result = TripPlanningContextStateSchema.parse(body);
      setSaved(result); setVersion(result.version); setDraft(draftFor(result)); setPending(null); setDirty(false); setLatest(null); setNotice("Trip context saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn’t confirm the save. Try the same request again."); }
    finally { setBusy(false); }
  }
  return <form className="trip-context-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
    <p className="trip-context-note">Shared with the trip’s organizers and used by Commons. Saving doesn’t change bookings, attendance, or the budget target in Money.</p>
    {saved.updatedByName ? <p className="trip-context-meta">Last saved by {saved.updatedByName}</p> : <p className="trip-context-meta">Starts from your saved trip setup.</p>}
    <fieldset disabled={!ready || busy || Boolean(pending)}>
      <label>Purpose<textarea rows={3} maxLength={500} value={draft.summary} onChange={event => change("summary", event.target.value)} placeholder="A relaxed weekend to reconnect with friends" /></label>
      <label>Pace<input maxLength={160} value={draft.pace} onChange={event => change("pace", event.target.value)} placeholder="One main activity a day, with afternoons open" /></label>
      <label>Priorities <small>One per line · up to 12</small><textarea rows={4} value={draft.goals} maxLength={2171} onChange={event => change("goals", event.target.value)} placeholder={"Time together\nGood food\nEasy walks"} /></label>
      <label>Things to keep in mind <small>One per line · up to 12</small><textarea rows={3} value={draft.constraints} maxLength={2171} onChange={event => change("constraints", event.target.value)} placeholder="Keep driving to a minimum" /></label>
      <fieldset className="trip-context-budget"><legend>Planning budget range <small>Optional · whole trip</small></legend><div>
        <label>From<span className="money-input"><b aria-hidden="true">{currencySymbol(draft.currency)}</b><input aria-label={`Planning budget minimum in ${draft.currency}`} inputMode="decimal" value={draft.minimum} onChange={event => change("minimum", event.target.value)} placeholder="0.00" /></span></label>
        <label>Up to<span className="money-input"><b aria-hidden="true">{currencySymbol(draft.currency)}</b><input aria-label={`Planning budget maximum in ${draft.currency}`} inputMode="decimal" value={draft.maximum} onChange={event => change("maximum", event.target.value)} placeholder="0.00" /></span></label>
        <p>{currencyLabel(draft.currency)}</p>
      </div></fieldset>
    </fieldset>
    {latest ? <section className="trip-context-conflict"><h2>Latest saved context</h2><p>Saved by {latest.updatedByName ?? "another organizer"}. Compare it with your edits above.</p><dl><dt>Purpose</dt><dd>{latest.brief.summary || "Not set"}</dd><dt>Pace</dt><dd>{latest.brief.pace || "Not set"}</dd><dt>Priorities</dt><dd>{latest.brief.goals.join("; ") || "Not set"}</dd><dt>Things to keep in mind</dt><dd>{latest.brief.constraints.join("; ") || "Not set"}</dd><dt>Planning budget</dt><dd>{latest.brief.currency ?? ""} {latest.brief.budgetMinimumCents === null ? "No lower limit" : (latest.brief.budgetMinimumCents / 100).toFixed(2)} – {latest.brief.budgetMaximumCents === null ? "No upper limit" : (latest.brief.budgetMaximumCents / 100).toFixed(2)}</dd></dl><button type="button" onClick={() => { setVersion(latest.version); setSaved(latest); setLatest(null); setError(""); setNotice("Your edits are kept. Save context to replace the version you reviewed."); }}>Keep my edits for review</button><button type="button" onClick={() => { setVersion(latest.version); setSaved(latest); setDraft(draftFor(latest)); setDirty(false); setLatest(null); setError(""); setNotice("Loaded the saved context."); }}>Use saved context</button></section> : null}
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    <p role="status">{notice}</p>
    <button className="trip-context-save" disabled={!ready || busy || Boolean(latest) || (!dirty && !pending)} type="submit">{busy ? "Saving…" : pending ? "Retry save" : "Save context"}</button>
  </form>;
}
