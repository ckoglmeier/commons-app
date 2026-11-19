"use client";

import { createContext, useContext } from "react";
import { type CompareStaysSnapshot, type StayComparisonFocus } from "../lib/compare-stays";

export type StayComparisonViewContext = { snapshot: CompareStaysSnapshot; selectedIds: string[]; disabled: boolean; select: (id: string, included: boolean) => void };
export const ComparisonContext = createContext<StayComparisonViewContext | null>(null);
const date = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));

export function ComparedStayRow({ id, focus }: { id: string; focus: StayComparisonFocus }) {
    const context = useContext(ComparisonContext);
    const option = context?.snapshot.options.find(item => item.id === id);
    if (!context || !option) return null;
    const groups = {
      price: <div key="price"><dt>Recorded price</dt><dd>{option.price.length ? option.price.map((line, index) => <p key={index}>{line}</p>) : "Not recorded"}</dd></div>,
      location: <div key="location"><dt>Location</dt><dd>{option.address || "Address not recorded"}<p>{option.distance}</p></dd></div>,
      notes: <div key="notes"><dt>Saved notes</dt><dd className="compare-stays-notes">{option.notes || "No notes recorded. Check beds, rooms and accessibility with the property."}</dd></div>,
    };
    const fields = focus === "overview" ? ["price", "location", "notes"] as const : [focus, ...(["price", "location", "notes"] as const).filter(key => key !== focus)];
    return <li className="compare-stays-option" data-stay-id={option.id}>
      <h3>{option.name}</h3>
      <p className="review-caption">{date(option.startsOn)} – {date(option.endsOn)} · {option.nights} {option.nights === 1 ? "night" : "nights"} · {option.people} {option.people === 1 ? "person" : "people"}</p>
      <dl className="compare-stays-facts">{fields.map(key => groups[key])}</dl>
      <p className="review-caption">Recorded source: {option.sourceLabel || "Saved stay"}. Prices are as entered.</p>
      <details className="compare-stays-unknowns"><summary>What needs checking</summary><ul>{option.unknowns.map(item => <li key={item}>{item}</li>)}</ul></details>
      <div className="compare-stays-option-actions">
        <label><input type="checkbox" checked={context.selectedIds.includes(option.id)} disabled={context.disabled || context.selectedIds.length >= 24 && !context.selectedIds.includes(option.id)} onChange={event => context.select(option.id, event.target.checked)} />Include {option.name} in shortlist</label>
        {option.sourceUrl ? <a className="cm-action cm-action--quiet" href={option.sourceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open listing<span className="sr-only"> for {option.name} (opens in a new tab)</span></a> : null}
      </div>
    </li>;
}

/** Ordinary React control arm: identical option components, data and selection state. */
export function CompareStaysReact({ focus, ...context }: StayComparisonViewContext & { focus: StayComparisonFocus }) {
  return <ComparisonContext.Provider value={context}><ul className="compare-stays-options">{context.snapshot.options.map(option => <ComparedStayRow key={option.id} id={option.id} focus={focus} />)}</ul></ComparisonContext.Provider>;
}
