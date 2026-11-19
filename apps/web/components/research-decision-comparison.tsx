"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DecisionCandidate, DecisionSource, ResearchDecisionComparison } from "@commons/contracts";
import {
  researchCandidatePrice, researchCandidateSources, researchDecisionEdit, researchDecisionEditChanged,
  researchDecisionEditIsCurrent, researchDecisionPins, researchDecisionScopeIsCurrent, setResearchDecisionNote, setResearchDecisionSelection,
  type ResearchDecisionEdit, type ResearchDecisionQuestion, type ResearchDecisionScope,
} from "../lib/research-decision-view";

// The host updates comparison from the durable receipt before returning saved.
// failed means a confirmed refusal/non-save; transport uncertainty must throw instead.
export type ResearchDecisionSaveResult = { status: "saved" | "stale" | "failed" };
/** Domain renderer only. The host supplies permitted state, persistence and the existing conversation. */
export function ResearchDecisionComparisonView({ comparison, scope, sources, canEdit = false, stale = false, onSave, onQuestion }: {
  comparison: ResearchDecisionComparison;
  scope: ResearchDecisionScope;
  sources: DecisionSource[];
  canEdit?: boolean;
  stale?: boolean;
  onSave?: (edit: ResearchDecisionEdit) => Promise<ResearchDecisionSaveResult>;
  onQuestion?: (question: ResearchDecisionQuestion) => void;
}) {
  const id = useId(), [edit, setEdit] = useState<ResearchDecisionEdit | null>(null);
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState("");
  const mounted = useRef(true), saveInFlight = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = edit ?? researchDecisionEdit(comparison);
  const changed = edit !== null && researchDecisionEditChanged(edit, comparison);
  const editStale = edit !== null && !researchDecisionEditIsCurrent(edit, comparison);
  const scopeMatches = researchDecisionScopeIsCurrent(scope, comparison), historical = stale || !scopeMatches;
  const blocked = historical || editStale || saving || !canEdit || !onSave;
  const ready = comparison.candidates.filter(candidate => candidate.fit !== "unsuitable");
  const ruledOut = comparison.candidates.filter(candidate => candidate.fit === "unsuitable");
  const change = (value: ResearchDecisionEdit) => { setEdit(researchDecisionEditChanged(value, comparison) ? value : null); setNotice(""); };
  const discard = () => { setEdit(null); setNotice(""); requestAnimationFrame(() => heading.current?.focus()); };
  const save = async () => {
    if (blocked || !changed || !onSave || saveInFlight.current) return;
    saveInFlight.current = true; setSaving(true); setNotice("");
    try {
      const result = await onSave(current);
      if (!mounted.current) return;
      if (result.status === "saved") { setEdit(null); setNotice("Shortlist saved."); }
      else setNotice(result.status === "stale" ? "The comparison changed. Your edits are still here; review the latest version before saving." : "The shortlist couldn’t be saved. Your edits are still here. Try again.");
    } catch {
      if (mounted.current) setNotice("Saving wasn’t confirmed. Your edits are still here. Check the latest comparison before retrying.");
    } finally { saveInFlight.current = false; if (mounted.current) setSaving(false); }
  };
  const renderCandidate = (candidate: DecisionCandidate) => {
    const price = researchCandidatePrice(candidate), evidence = researchCandidateSources(comparison, candidate, sources);
    const decidingReason = candidate.reasons.find(reason => /sober driver/i.test(reason)) ?? candidate.reasons[0];
    const selected = current.selectedIds.includes(candidate.id), note = current.notes.find(item => item.candidateId === candidate.id)?.text ?? "";
    const candidateId = `${id}-${candidate.id}`;
    return <li className="research-decision-option" key={candidate.id}>
      <div className="research-decision-option-heading">
        <h3>{candidate.label}</h3>
        <span className="research-decision-fit">{candidate.fit === "unsuitable" ? "Doesn’t fit" : candidate.fit === "conditional" ? "Needs checking" : "Fits listed requirements"}</span>
      </div>
      <div className="research-decision-price"><strong>{price.amount}</strong>{price.basis && <span>{price.basis}</span>}{price.perPerson && <span>{price.perPerson} per person</span>}</div>
      {scopeMatches && comparison.kind === "transport" && scope.legs.length > 0 && <p className="research-decision-meta">Route coverage: {candidate.coverage.filter(leg => scope.legs.some(item => item.id === leg)).length} of {scope.legs.length} legs. Capacity and availability still need checking.</p>}
      {decidingReason && <p>{decidingReason}</p>}
      {canEdit && onSave ? <label className="research-decision-shortlist" htmlFor={`${candidateId}-selected`}>
        <input id={`${candidateId}-selected`} type="checkbox" checked={selected} disabled={blocked || candidate.fit === "unsuitable" && !selected}
          onChange={event => change(setResearchDecisionSelection(current, candidate, event.target.checked))} />
        {selected ? "On shortlist" : "Add to shortlist"}
      </label> : selected && <p className="research-decision-meta">On shortlist</p>}
      <details className="research-decision-details"><summary>Details & sources</summary>
        {candidate.reasons.length > 0 && <ul className="research-decision-reasons">{candidate.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
        {evidence.length ? <ul className="research-decision-sources">{evidence.map(source => <li key={`${source.runId}:${source.sourceId}`}>
          {source.handoff ? <a className="research-decision-source-link" href={source.handoff} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{source.title || "Open source"} <span className="research-decision-sr-only">(opens in a new tab)</span></a> : <p>{source.title || "Captured reference"}</p>}
          <p className="research-decision-meta">{source.provider} · {source.coverage === "snippet" ? "Search snippet" : "Captured page"} · Retrieved <time dateTime={source.retrievedAt}>{new Date(source.retrievedAt).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} UTC</time></p>
          <blockquote>{source.excerpt}</blockquote>
        </li>)}</ul> : <p className="research-decision-meta">No captured source for this option yet.</p>}
        {canEdit && onSave ? <label className="research-decision-note" htmlFor={`${candidateId}-note`}>Organizer note
          <textarea id={`${candidateId}-note`} value={note} maxLength={1000} rows={2} disabled={blocked}
            onChange={event => change(setResearchDecisionNote(current, candidate.id, event.target.value))} />
        </label> : note && <p className="research-decision-saved-note">{note}</p>}
      </details>
    </li>;
  };
  return <section className="research-decision" aria-labelledby={`${id}-title`} aria-busy={saving}>
    <header className="research-decision-header"><p className="research-decision-meta">Organizers only · Comparison {comparison.revision}</p><h2 id={`${id}-title`} ref={heading} tabIndex={-1}>{comparison.title}</h2>
      {scopeMatches && <p>{scope.partySize} travelers{scope.requestedWeekdays.length > 0 ? ` · ${scope.requestedWeekdays.join(" / ")}` : ""}</p>}
      <p className="research-decision-meta">{comparison.evidenceMode === "fixture" ? "Test data. Venue policies and prices are invented for testing." : "References only. Prices and availability need checking."} Nothing is booked.</p>
      {scopeMatches && comparison.kind === "transport" && scope.legs.length > 0 && <details className="research-decision-details"><summary>Trip requirements</summary><ul className="research-decision-reasons">{scope.legs.map(leg => <li key={leg.id}>{leg.label} · {leg.partySize} travelers{leg.needsLuggage ? " with luggage" : ""}</li>)}</ul></details>}
    </header>
    {historical && <p className="research-decision-attention">Trip details changed after this comparison. Reopen research for a current result.</p>}
    {editStale && <div className="research-decision-attention"><p>The comparison changed while you were editing. Your unsaved edits are still here.</p><button className="cm-action" type="button" disabled={saving} onClick={discard}>Discard edits and use latest</button></div>}
    {comparison.question && <div className="research-decision-question"><p>{comparison.question}</p>{onQuestion && !historical && <button className="cm-action" type="button" disabled={saving || editStale} onClick={() => onQuestion({ ...researchDecisionPins(comparison), question: comparison.question! })}>Answer in conversation</button>}</div>}
    {ready.length ? <ul className="research-decision-options">{ready.map(renderCandidate)}</ul> : <p>No fitting options yet. Resolve the open question before expanding the search.</p>}
    {ruledOut.length > 0 && <details className="research-decision-ruled-out"><summary>Doesn’t fit ({ruledOut.length})</summary><ul className="research-decision-options">{ruledOut.map(renderCandidate)}</ul></details>}
    {comparison.limitations.length > 0 && <details className="research-decision-limitations"><summary>Research limits</summary><ul>{comparison.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    {canEdit && onSave && <footer className="research-decision-footer"><p className="research-decision-meta">Shortlisting changes this comparison only, not the itinerary.</p><div className="research-decision-actions"><button className="cm-action cm-action--primary" type="button" disabled={blocked || !changed} onClick={() => void save()}>{saving ? "Saving shortlist…" : "Save shortlist"}</button>{changed && !editStale && <button className="cm-action" type="button" disabled={saving} onClick={discard}>Discard edits</button>}</div></footer>}
    <p className="research-decision-notice" role="status">{notice}</p>
  </section>;
}
