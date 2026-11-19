"use client";

import { newPropertyRow, type PropertyRow } from "@/lib/recipe-client";

/** Places an organizer was given. The estimate is the organizer's own and is shown to everyone as an estimate, never a quote. */
export function RecipePropertiesEditor({ rows, onChange, disabled = false, error }: { rows: PropertyRow[]; onChange: (rows: PropertyRow[]) => void; disabled?: boolean; error?: string | null }) {
  const update = (id: string, patch: Partial<PropertyRow>) => onChange(rows.map(row => row.id === id ? { ...row, ...patch } : row));
  return <div className="recipe-alternatives">
    {rows.map((row, index) => <fieldset className="recipe-property" key={row.id} disabled={disabled}>
      <legend>Place {index + 1}</legend>
      <label className="fieldnotes-field"><span>Name</span><input type="text" value={row.name} maxLength={80} onChange={event => update(row.id, { name: event.target.value })} required /></label>
      <label className="fieldnotes-field"><span>Link you were given</span><input type="url" inputMode="url" value={row.url} maxLength={2048} placeholder="https://" onChange={event => update(row.id, { url: event.target.value })} required /></label>
      <label className="fieldnotes-field"><span>Short description (optional)</span><input type="text" value={row.description} maxLength={180} onChange={event => update(row.id, { description: event.target.value })} /></label>
      <label className="fieldnotes-field"><span>Rooms, as described</span><input type="text" value={row.rooms} maxLength={180} placeholder="For example, six king rooms" onChange={event => update(row.id, { rooms: event.target.value })} required /></label>
      <label className="fieldnotes-field"><span>Beds</span><select value={row.beds} onChange={event => update(row.id, { beds: event.target.value as PropertyRow["beds"] })}>
        <option value="unknown">Not listed</option><option value="separate_beds_available">Rooms with separate beds are available</option><option value="king_only">King beds only</option></select></label>
      <div className="recipe-estimate"><p className="recipe-note">Your estimate, if you have one. Empty shows “Price unknown”. It’s shown as an estimate, never a quote.</p>
        <label className="fieldnotes-field"><span>Low (dollars)</span><input type="text" inputMode="decimal" value={row.min} onChange={event => update(row.id, { min: event.target.value })} /></label>
        <label className="fieldnotes-field"><span>High (dollars)</span><input type="text" inputMode="decimal" value={row.max} onChange={event => update(row.id, { max: event.target.value })} /></label>
        <label className="fieldnotes-field"><span>Per</span><select value={row.basis} onChange={event => update(row.id, { basis: event.target.value as PropertyRow["basis"] })}><option value="per_room">room</option><option value="per_person">person</option><option value="total">whole group</option></select></label>
        <label className="fieldnotes-field"><span>For</span><select value={row.period} onChange={event => update(row.id, { period: event.target.value as PropertyRow["period"] })}><option value="nightly">each night</option><option value="stay">the whole stay</option></select></label>
        <label className="fieldnotes-field"><span>Fees</span><select value={row.fees} onChange={event => update(row.id, { fees: event.target.value as PropertyRow["fees"] })}><option value="unknown">Unknown</option><option value="included">Included</option><option value="excluded">Not included</option></select></label></div>
      <button type="button" className="cm-action" disabled={rows.length <= 2} onClick={() => onChange(rows.filter(item => item.id !== row.id))} aria-label={`Remove place ${index + 1}`}>Remove</button>
    </fieldset>)}
    <div className="poll-action-row"><button type="button" className="cm-action" disabled={disabled || rows.length >= 8} onClick={() => onChange([...rows, newPropertyRow()])}>Add a place</button></div>
    {error ? <p className="recipe-error" role="alert">{error}</p> : null}
  </div>;
}
