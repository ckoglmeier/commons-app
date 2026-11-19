"use client";
import { useEffect, useRef, useState } from "react";
import { airportTimezone } from "@/lib/location-timezone";
import { clockTime } from "@/lib/clock-time";
import { formatTravelReviewDate } from "@/lib/travel-review-date";
import { appendFlightConnection, blankFlightConnection, maxFlightsPerDirection, removeFlightConnection, summarizeFlightReview, type FlightLegReview } from "@/lib/flight-booking-review";
import { TimeInput } from "./time-input";
import type { FlightConnection } from "@commons/contracts";
import { LocationTimezoneField } from "./location-timezone-field";

export { blankFlightConnection, summarizeFlightReview, type FlightLegReview } from "@/lib/flight-booking-review";

type ConnectionKeys = Partial<Record<FlightLegReview["kind"], string[]>>;
type EditorView = {
  legs: FlightLegReview[];
  generation: number;
  serial: number;
  keys: ConnectionKeys;
  opened: Record<string, boolean>;
  focus: { key: string; target: "airport" | "summary" | "undo" } | null;
  undo: { legs: FlightLegReview[]; keys: ConnectionKeys; removedKey: string } | null;
};
function initialView(legs: FlightLegReview[], generation: number): EditorView {
  return { legs, generation, serial: 0, keys: Object.fromEntries(legs.map(leg => [leg.kind, leg.connections?.map((_, i) => `${generation}-${leg.kind}-${i}`) ?? []])), opened: {}, focus: null, undo: null };
}

export function FlightBookingFields({ legs, onChange, removeHome, addHome }: { legs: FlightLegReview[]; onChange: (legs: FlightLegReview[]) => void; removeHome: () => void; addHome: () => void }) {
  const [view, setView] = useState(() => initialView(legs, 0));
  const root = useRef<HTMLFieldSetElement>(null);
  // Imported or reopened drafts cannot inherit identities or Undo from old data.
  if (view.legs !== legs) setView(initialView(legs, view.generation + 1));
  useEffect(() => {
    if (!view.focus) return;
    const { key, target } = view.focus;
    const selector = target === "undo" ? "[data-flight-undo]" : `[data-flight-key="${key}"] ${target === "airport" ? "input" : "summary"}`;
    root.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [view.focus]);

  function update(index: number, value: Partial<FlightLegReview>, keys = view.keys) {
    const next = legs.map((leg, i) => i === index ? { ...leg, ...value } : leg);
    setView({ ...view, legs: next, keys, undo: null, focus: null });
    onChange(next);
  }
  function updateConnection(index: number, connectionIndex: number, field: keyof FlightConnection, value: string) {
    const leg = legs[index];
    update(index, summarizeFlightReview(leg, (leg.connections ?? []).map((item, i) => i === connectionIndex ? { ...item, [field]: value || null, ...(field === "origin" && !item.departureTimezone && airportTimezone(value) ? { departureTimezone: airportTimezone(value) } : {}), ...(field === "destination" && !item.arrivalTimezone && airportTimezone(value) ? { arrivalTimezone: airportTimezone(value) } : {}) } : item)));
  }
  function addConnection(index: number) {
    const leg = appendFlightConnection(legs[index]);
    if (leg === legs[index]) return;
    const key = `${view.generation}-added-${view.serial + 1}`;
    const next = legs.map((item, i) => i === index ? leg : item);
    setView({ ...view, legs: next, serial: view.serial + 1, keys: { ...view.keys, [leg.kind]: [...(view.keys[leg.kind] ?? []), key] }, opened: { ...view.opened, [key]: true }, undo: null, focus: { key, target: "airport" } });
    onChange(next);
  }
  function removeConnection(index: number, connectionIndex: number) {
    const leg = removeFlightConnection(legs[index], connectionIndex);
    if (leg === legs[index]) return;
    const next = legs.map((item, i) => i === index ? leg : item);
    const key = view.keys[leg.kind]![connectionIndex];
    setView({ ...view, legs: next, keys: { ...view.keys, [leg.kind]: view.keys[leg.kind]!.filter((_, i) => i !== connectionIndex) }, undo: { legs, keys: view.keys, removedKey: key }, focus: { key, target: "undo" } });
    onChange(next);
  }
  function undoRemoval() {
    if (!view.undo) return;
    const previous = view.undo;
    setView({ ...view, legs: previous.legs, keys: previous.keys, undo: null, focus: { key: previous.removedKey, target: "summary" } });
    onChange(previous.legs);
  }

  return <fieldset ref={root} className="flight-segments-review"><legend>Flights in this booking</legend>{legs.map((leg, index) => {
    const endpoint = leg.kind === "arrival" ? leg.connections?.at(-1) : leg.connections?.[0];
    const timezone = (leg.kind === "arrival" ? endpoint?.arrivalTimezone : endpoint?.departureTimezone) ?? "";
    return <section key={leg.kind} className="flight-segment-editor">
      <div><span>{index + 1}</span><strong>{leg.kind === "arrival" ? "Flight there" : "Flight home"}</strong>{leg.kind === "departure" ? <button type="button" aria-label="Remove flight home" onClick={removeHome}>Remove</button> : null}</div>
      {leg.connections?.length ? <>
        <p className="flight-summary"><strong>{leg.route || "Route needs review"}</strong><span>{leg.kind === "arrival" ? "Trip arrival" : "Trip departure"} · {formatTravelReviewDate(leg.date)} · {clockTime(leg.time)} {timezone}</span><small>{leg.kind === "arrival" ? "From the final flight’s arrival" : "From the first flight’s departure"}</small></p>
        {leg.connections.map((connection, ci) => {
          const key = view.keys[leg.kind]?.[ci] ?? `${view.generation}-${leg.kind}-${ci}`;
          const open = view.opened[key] ?? (!connection.origin || !connection.destination || !connection.arrivalTime || !connection.departureTime || !connection.arrivalDate || !connection.departureDate);
          const removable = leg.connections!.length > 1;
          return <div className="flight-connection-row" data-flight-key={key} key={key}>
            <details className="flight-connection" open={open} onToggle={event => { const opened = event.currentTarget.open; setView(current => current.opened[key] === opened ? current : { ...current, opened: { ...current.opened, [key]: opened } }); }}>
              <summary className={removable ? "flight-connection-summary-removable" : undefined}><span className="flight-connection-caret" aria-hidden="true">▸</span><span className="flight-connection-label">{connection.flightNumber || `Flight ${ci + 1}`} · {connection.origin || "From?"} → {connection.destination || "To?"}<small>{clockTime(connection.departureTime)} → {clockTime(connection.arrivalTime)}{connection.departureDate && connection.arrivalDate && connection.arrivalDate > connection.departureDate ? ` · Arrives ${formatTravelReviewDate(connection.arrivalDate)}` : ""}</small></span><span className="flight-connection-edit">{open ? "Done" : "Edit"}</span></summary>
              <div className="travel-form-grid flight-airport-fields">{(["origin", "destination", "flightNumber"] as const).map(field => <label className="field" key={field}><span>{field === "origin" ? "Departure airport" : field === "destination" ? "Arrival airport" : "Flight number"}</span><input value={connection[field] ?? ""} maxLength={field === "flightNumber" ? 30 : 80} onChange={event => updateConnection(index, ci, field, event.target.value)} /></label>)}</div>
              {(["departure", "arrival"] as const).map(endpoint => <div className="flight-endpoint" key={endpoint}><strong>{endpoint === "departure" ? "Departs" : "Arrives"}</strong><div className="travel-form-grid flight-endpoint-fields">
                <label className="field"><span>{endpoint === "departure" ? "Departure date" : "Arrival date"}</span><input type="date" value={connection[`${endpoint}Date`] ?? ""} onChange={event => updateConnection(index, ci, `${endpoint}Date`, event.target.value)} /></label>
                <label className="field"><span>{endpoint === "departure" ? "Departure local time" : "Arrival local time"}</span><TimeInput aria-label={`${endpoint === "departure" ? "Departure" : "Arrival"} local time`} value={connection[`${endpoint}Time`] ?? ""} onChange={event => updateConnection(index, ci, `${endpoint}Time`, event.target.value)} /></label>
                <LocationTimezoneField label={`${endpoint === "departure" ? "Departure" : "Arrival"} timezone`} value={connection[`${endpoint}Timezone`] ?? ""} onChange={value => updateConnection(index, ci, `${endpoint}Timezone`, value)} initialQuery={connection[endpoint === "departure" ? "origin" : "destination"] ?? ""} />
              </div></div>)}
              {index === 0 && ci > 0 && !legs.some(item => item.kind === "departure") ? <button type="button" className="travel-add-another" onClick={() => { const outward = leg.connections!.slice(0, ci), home = leg.connections!.slice(ci); onChange([summarizeFlightReview(leg, outward), summarizeFlightReview({ ...leg, kind: "departure" }, home)]); }}>This starts the flight home</button> : null}
            </details>
            {removable ? <button className="flight-connection-remove" type="button" aria-label={`Remove ${connection.flightNumber || `flight ${ci + 1}`} from ${leg.kind === "arrival" ? "flight there" : "flight home"}`} onClick={() => removeConnection(index, ci)}>Remove</button> : null}
          </div>;
        })}
        {(leg.connections.length < maxFlightsPerDirection) ? <button type="button" className="flight-add-connection" onClick={() => addConnection(index)}><span aria-hidden="true">＋</span> Add connection</button> : <p className="expense-mode-help">Maximum {maxFlightsPerDirection} flights in this direction.</p>}
      </> : <>
        <label className="field"><span>Route</span><input value={leg.route} maxLength={120} required onChange={event => update(index, { route: event.target.value })} placeholder="DEN → SNA" /></label>
        <div className="travel-form-grid"><label className="field"><span>{leg.kind === "arrival" ? "Arrival date" : "Departure date"}</span><input type="date" value={leg.date} required onChange={event => update(index, { date: event.target.value })} /></label><label className="field"><span>{leg.kind === "arrival" ? "Arrival time" : "Departure time"}</span><TimeInput value={leg.time} required onChange={event => update(index, { time: event.target.value })} /></label></div>
        <button type="button" className="cm-action" onClick={() => update(index, { connections: [blankFlightConnection()] }, { ...view.keys, [leg.kind]: [`${view.generation}-details-${view.serial}`] })}>Add departure and arrival details</button>
      </>}
    </section>;
  })}{view.undo ? <div className="flight-connection-undo"><span role="status">Flight removed from this draft.</span><button type="button" data-flight-undo onClick={undoRemoval}>Undo</button></div> : null}{!legs.some(item => item.kind === "departure") ? <button className="travel-add-another" type="button" onClick={addHome}>Add flight home</button> : null}</fieldset>;
}
