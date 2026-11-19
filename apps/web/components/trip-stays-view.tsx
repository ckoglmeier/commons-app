"use client";
import { useMemo, useState } from "react";
import type { CommonsParticipant, CommonsSummary, ItineraryItem, Stay } from "@commons/contracts";
import { stayComparison } from "../lib/stay-compare";
import { StayAddressActions } from "./stay-address-actions";

const day = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const nights = (stay: Stay) => stay.startsOn === stay.endsOn ? day(stay.startsOn) : `${day(stay.startsOn)} – ${day(stay.endsOn)}`;

/** Plan → Stays: where the group is staying, and the options still being
 * considered. Asking the group opens an ordinary private lodging poll draft. */
export function TripStaysView({ commons, participants, stays, itinerary, canEditStays, canAskGroup, editorOpen, editStay, openStay, addOption, saveNote, copyAddress, mapPath }: {
  commons: CommonsSummary; participants: CommonsParticipant[]; stays: Stay[]; itinerary: ItineraryItem[]; canEditStays: boolean; canAskGroup: boolean; editorOpen?: boolean;
  saveNote: (stay: Stay, note: string) => Promise<void>;
  editStay: (id: string) => void; openStay: (id: string) => void; addOption: () => void;
  copyAddress: (address: string) => void | Promise<void>; mapPath?: string;
}) {
  const staying = stays.filter(stay => stay.status !== "considering").sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const options = stays.filter(stay => stay.status === "considering").sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.name.localeCompare(b.name));
  const compared = useMemo(() => stayComparison(options, itinerary, commons.timezone), [options, itinerary, commons.timezone]);
  const [left, setLeft] = useState<Set<string>>(() => new Set());
  const [note, setNote] = useState<{ id: string; text: string; busy: boolean; error: string } | null>(null);
  const included = options.filter(stay => !left.has(stay.id));
  const pollPath = `/c/${commons.id}/polls/new?stayIds=${included.map(stay => stay.id).join(",")}`;
  const choosing = canAskGroup && options.length >= 2;
  async function submitNote(stay: Stay) {
    if (!note) return;
    setNote({ ...note, busy: true, error: "" });
    try { await saveNote(stay, note.text.trim()); setNote(null); }
    catch (error) { setNote(current => current && { ...current, busy: false, error: error instanceof Error ? error.message : "Note not saved. Try again." }); }
  }
  const names = (stay: Stay) => stay.includedPersonIds.map(id => participants.find(person => person.id === id)?.displayName).filter(Boolean);
  return <div className="product-view trip-stays-view">
    {/* Travel & stays shows one shared header with the Add menu. */}
    <section className="event-logistics-section" aria-labelledby="trip-stays-booked-title">
      <div className="event-logistics-heading"><h3 id="trip-stays-booked-title">Where we’re staying</h3></div>
      {staying.length ? <ul className="trip-stays-list">{staying.map(stay => <li key={stay.id}>
        <div className="trip-stays-row">
          <button type="button" className="trip-stays-name" onClick={() => openStay(stay.id)}><strong>{stay.name}</strong>
            <small>{nights(stay)} · {stay.status === "confirmed" ? "Confirmed" : "Planned"} · {names(stay).length} {names(stay).length === 1 ? "person" : "people"}</small></button>
          {canEditStays ? <button type="button" className="cm-action cm-action--quiet" onClick={() => editStay(stay.id)} aria-label={`Edit stay: ${stay.name}`}>Edit</button> : null}
        </div>
        <p className="event-stay-address">{stay.address}</p>
        <StayAddressActions name={stay.name} address={stay.address} copy={copyAddress} />
      </li>)}</ul>
        : commons.lodging ? <div className="trip-stays-row"><strong>{commons.lodging.name}</strong><p>{commons.lodging.address}</p></div>
        : <p className="event-logistics-note">No stay chosen yet. Mark one planned or confirmed when the group picks.</p>}
    </section>
    <section className="event-logistics-section" aria-labelledby="trip-stays-options-title">
      <div className="event-logistics-heading"><h3 id="trip-stays-options-title">{staying.length ? "Other options we considered" : "Options we’re considering"}</h3>
        {canEditStays ? <button type="button" className="cm-action" disabled={editorOpen} onClick={addOption}>Add an option</button> : null}</div>
      {options.length ? <ul className="trip-stays-list">{options.map(stay => {
        const facts = compared.get(stay.id)!, editing = note?.id === stay.id;
        return <li key={stay.id}>
          <div className="trip-stays-row">
            <button type="button" className="trip-stays-name" onClick={() => openStay(stay.id)}><strong>{stay.name}</strong>
              <small>{nights(stay)} · {facts.nights} {facts.nights === 1 ? "night" : "nights"}</small></button>
            {canEditStays ? <button type="button" className="cm-action cm-action--quiet" onClick={() => editStay(stay.id)} aria-label={`Edit option: ${stay.name}`}>Edit</button> : null}
          </div>
          <dl className="trip-stays-compare">
            <div><dt>Price</dt><dd>{facts.price ? <>{facts.price.total}{facts.price.perRoomPerNight ? <><br />{facts.price.perRoomPerNight}</> : null}{facts.price.perPersonPerNight ? <><br />{facts.price.perPersonPerNight}</> : null}</> : "Not added yet"}</dd></div>
            <div><dt>Location</dt><dd>{stay.address || "No address yet"}<br />{facts.distance}</dd></div>
            <div><dt>Notes</dt><dd>{editing ? <form className="trip-stays-note" onSubmit={event => { event.preventDefault(); void submitNote(stay); }}>
              <label className="trip-map-sr" htmlFor={`stay-note-${stay.id}`}>Notes for {stay.name}</label>
              <textarea id={`stay-note-${stay.id}`} rows={3} maxLength={1000} value={note.text} placeholder="Beds and rooms, parking, cancellation, what people liked…" onChange={event => setNote({ ...note, text: event.target.value })} />
              {note.error ? <p className="form-error" role="alert">{note.error}</p> : null}
              <div className="trip-map-actions"><button type="submit" className="cm-action cm-action--primary" disabled={note.busy}>{note.busy ? "Saving…" : "Save note"}</button>
                <button type="button" className="cm-action" disabled={note.busy} onClick={() => setNote(null)}>Cancel</button></div>
            </form> : <>{stay.details ? <span className="trip-stays-note-text">{stay.details}</span> : <span className="event-logistics-note">No notes yet.</span>}
              {canEditStays ? <button type="button" className="cm-action cm-action--quiet" disabled={Boolean(note)} onClick={() => setNote({ id: stay.id, text: stay.details ?? "", busy: false, error: "" })}>{stay.details ? "Edit note" : "Add note"}</button> : null}</>}</dd></div>
          </dl>
          <div className="trip-stays-footer">
            {stay.bookingUrl ? <a className="trip-stays-link" href={stay.bookingUrl} target="_blank" rel="noreferrer">Open listing</a> : null}
            {choosing ? <label className="trip-stays-include"><input type="checkbox" checked={!left.has(stay.id)}
              onChange={event => setLeft(current => { const next = new Set(current); if (event.target.checked) next.delete(stay.id); else next.add(stay.id); return next; })} /> Include in the poll</label> : null}
          </div>
        </li>;
      })}</ul>
        : <p className="event-logistics-note">Add the places you’re considering. A name and a link are enough.</p>}
      {options.length ? <div className="trip-stays-actions">
        {choosing ? included.length >= 2 ? <a className="cm-action cm-action--primary" href={pollPath}>Ask which place to stay ({included.length})</a>
          : <span className="event-logistics-note">Include at least two options in the poll.</span> : null}
        {mapPath ? <a className="cm-action" href={mapPath}>Compare on the map</a> : null}
      </div> : null}
      {canAskGroup && options.length === 1 ? <p className="event-logistics-note">Add another option to ask the group which they prefer.</p> : null}
      {choosing ? <p className="event-logistics-note">This starts a private “Which place should we stay?” poll draft with each option’s price and notes. You review it before sharing; nothing is booked.</p> : null}
    </section>
  </div>;
}
