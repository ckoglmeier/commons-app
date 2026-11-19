"use client";

import { newAlternativeRow, type AlternativeRow } from "@/lib/recipe-client";

/** Each option is one set of dates in one place, so the group answers about combinations rather than dates and places separately. */
export function RecipeAlternativesEditor({ rows, onChange, disabled = false, error }: { rows: AlternativeRow[]; onChange: (rows: AlternativeRow[]) => void; disabled?: boolean; error?: string | null }) {
  const update = (id: string, patch: Partial<AlternativeRow>) => onChange(rows.map(row => row.id === id ? { ...row, ...patch } : row));
  return <div className="recipe-alternatives">
    {rows.map((row, index) => <fieldset className="recipe-alternative" key={row.id} disabled={disabled}>
      <legend>Option {index + 1}</legend>
      <label className="fieldnotes-field"><span>Start date</span><input type="date" value={row.startsOn} onChange={event => update(row.id, { startsOn: event.target.value, endsOn: row.endsOn && row.endsOn >= event.target.value ? row.endsOn : event.target.value })} required /></label>
      <label className="fieldnotes-field"><span>End date</span><input type="date" value={row.endsOn} min={row.startsOn || undefined} onChange={event => update(row.id, { endsOn: event.target.value })} required /></label>
      <label className="fieldnotes-field recipe-alternative__place"><span>Place</span><input type="text" value={row.place} maxLength={60} placeholder="For example, Napa" onChange={event => update(row.id, { place: event.target.value })} required /></label>
      <button type="button" className="cm-action" disabled={rows.length <= 2} onClick={() => onChange(rows.filter(item => item.id !== row.id))} aria-label={`Remove option ${index + 1}`}>Remove</button>
    </fieldset>)}
    <div className="poll-action-row"><button type="button" className="cm-action" disabled={disabled || rows.length >= 10} onClick={() => onChange([...rows, newAlternativeRow()])}>Add an option</button></div>
    {error ? <p className="recipe-error" role="alert">{error}</p> : null}
  </div>;
}
