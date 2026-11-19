"use client";
import { useEffect, useState, type ReactNode } from "react";
import { planTemplateFor } from "@commons/domain";
import { TripBudgetInputsSchema, TripBudgetViewSchema, type TripBudgetView } from "@commons/contracts";
import { GroupBudgetWorksheet } from "@/lib/marketing/budget/budget-worksheet";
import { prefillTripBudget, tripBudgetLodgingReference } from "@/lib/trip-budget/prefill";
import { type BudgetInputs } from "@/lib/marketing/budget/budget-calculations";
import css from "./trip-budget-panel.module.css";

const COST_BASIS = { shared: "Everyone shares", per_person: "Each person pays", optional: "Only people who opt in" } as const;

export type TripBudgetPanelProps = {
  tripId: string;
  destinationName?: string;
  startsOn?: string | null;
  endsOn?: string | null;
  travelerCount?: number;
  currency?: string;
  /** The trip's plan template. Its optional costs seed a new worksheet, and its cost rules are listed. */
  templateKey?: string | null;
  canEdit: boolean;
  persistent: boolean;
  goingSlot?: ReactNode;
  embedded?: boolean;
  targetControl?: ReactNode;
  onSaved?: (inputs: BudgetInputs | null) => void;
};

/** Uses the same deterministic worksheet as the public pages, without marketing telemetry. */
export function TripBudgetPanel(props: TripBudgetPanelProps) {
  return <TripBudgetEditor key={props.tripId} {...props} />;
}
function TripBudgetEditor({ tripId, destinationName, startsOn, endsOn, travelerCount, currency, templateKey, canEdit, persistent, goingSlot, onSaved, embedded = false, targetControl }: TripBudgetPanelProps) {
  const costRules = planTemplateFor(templateKey).money.costRules;
  const [initial] = useState(() => prefillTripBudget({ destinationName, startsOn, endsOn, travelerCount, currency, optionalLabels: costRules.filter(rule => rule.basis === "optional").map(rule => rule.label) }));
  const [inputs, setInputs] = useState<BudgetInputs>(initial);
  const [saved, setSaved] = useState<TripBudgetView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const storageKey = `commons:sample-trip-budget:${tripId}`;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      try {
        let view: TripBudgetView;
        if (persistent) {
          const response = await fetch(`/api/v1/commons/${encodeURIComponent(tripId)}/budget/`, { signal: controller.signal, cache: "no-store" });
          if (!response.ok) throw new Error("Couldn’t load the saved budget. Try again.");
          view = TripBudgetViewSchema.parse(await response.json());
        } else {
          const local = localStorage.getItem(storageKey);
          const parsed = local ? TripBudgetInputsSchema.safeParse(JSON.parse(local)) : null;
          view = { inputs: parsed?.success ? parsed.data : null, version: 0, updatedAt: null, canEdit };
        }
        if (active) { setSaved(view); setInputs(view.inputs ?? initial); setError(""); setConflict(false); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Couldn’t load the saved budget. Try again.");
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [tripId, persistent, storageKey, canEdit, initial, loadAttempt]);
  useEffect(() => { if (saved) onSaved?.(saved.inputs); }, [saved, onSaved]);
  const editable = canEdit && saved?.canEdit === true;
  const dirty = saved && JSON.stringify(inputs) !== JSON.stringify(saved.inputs ?? initial);
  async function save() {
    if (!saved || !editable || saving || conflict) return;
    setSaving(true); setError("");
    const sent = structuredClone(inputs);
    try {
      let view: TripBudgetView;
      if (persistent) {
        const response = await fetch(`/api/v1/commons/${encodeURIComponent(tripId)}/budget/`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: saved.version, inputs: sent }) });
        const body = await response.json();
        if (!response.ok) { setConflict(response.status === 409); throw new Error(body.error || "Couldn’t confirm the save. Try again."); }
        view = TripBudgetViewSchema.parse(body);
      } else {
        localStorage.setItem(storageKey, JSON.stringify(sent));
        view = { inputs: sent, version: saved.version + 1, updatedAt: new Date().toISOString(), canEdit };
      }
      setSaved(view);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn’t confirm the save. Your edits are still here."); }
    finally { setSaving(false); }
  }
  if (loading) return <p role="status">Loading trip budget…</p>;
  if (!saved) return <div><p role="alert">{error}</p><button type="button" className="cm-action-secondary" onClick={() => { setLoading(true); setLoadAttempt(value => value + 1); }}>Try again</button></div>;
  const lodgingReference = saved.inputs ? undefined : tripBudgetLodgingReference(destinationName);
  return <div className={css.panel}>
    <GroupBudgetWorksheet summarySupplement={targetControl} summaryActions={(editable && <div className={css.actions}>
      <button type="button" className="cm-action" disabled={saving || conflict || (!dirty && saved.version > 0)} onClick={() => void save()}>{saving ? "Saving…" : "Save budget"}</button>
      <span role="status">{dirty ? "Unsaved changes" : saved.version > 0 ? persistent ? "Budget saved to this trip." : "Saved in this browser." : "Adjust the estimate, then save it to your trip."}</span>
    </div>)} embedded={embedded} title={embedded ? "Category estimates" : "Trip budget"} destinationName={destinationName} startingLodging={lodgingReference} lodgingReferenceLabel={lodgingReference ? <>Starting reference: {lodgingReference.marketName} rental average, {lodgingReference.source}, checked {lodgingReference.checkedAt}. <a href={lodgingReference.sourceUrl} target="_blank" rel="noreferrer">Source</a>. Adjust for your group and property.</> : undefined} defaultCurrency={initial.currency} value={inputs} onChange={setInputs} readOnly={!editable}
      storageNotice={persistent ? "Estimate each category’s whole-trip cost. Saved plans and expenses count toward these amounts; only the uncovered remainder adds to your forecast. This does not change what anyone owes." : "Sample budget changes stay in this browser. They don’t record expenses."} />
    {!editable && <p className={css.note}>An organizer can update this budget.</p>}
    {error && <p role="alert">{error}</p>}
    {conflict && <div><p>Loading the latest budget will replace your unsaved edits.</p><button type="button" className="cm-action-secondary" onClick={() => { setLoading(true); setLoadAttempt(value => value + 1); }}>Load latest budget</button></div>}
    {costRules.length ? <section className="cost-rules" aria-labelledby={`cost-rules-${tripId}`}><h3 id={`cost-rules-${tripId}`}>How costs usually split</h3><ul>{costRules.map(rule => <li key={rule.label}><span>{rule.label}</span><span>{COST_BASIS[rule.basis]}</span></li>)}</ul></section> : null}
    {goingSlot}
  </div>;
}
