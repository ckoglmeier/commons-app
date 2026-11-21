"use client";
import { planTemplateFor } from "@commons/domain";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type { CommonsSummary, ItineraryItem, PlacePin, Stay, TravelPlan } from "@commons/contracts";
import { directionsUrl, distanceKm, distanceLabel, filterTripMapPlaces, isRentalListing, placeLocationNote, stayDistances, tripMapDays, tripMapPlaces, type TripMapFilter, type TripMapPlace } from "../lib/trip-map";
import { TripMapCanvas, type MarkedPlace } from "./trip-map-canvas";
import { personFacingError } from "@/lib/person-facing-error";

type Point = { latitude: number; longitude: number };
const dayLabel = (day: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

/** Plan → Map: the stays being considered and the activities people added,
 * on one map. Pins are only ever saved by a person. */
export function TripMapView({ commons, stays, itinerary, transport = [], canEditStays, canEditActivities, savePin, editStay, openStay, openActivity, addMenu, travelPath, initialKind = "all" }: {
  commons: CommonsSummary; stays: Stay[]; itinerary: ItineraryItem[]; transport?: TravelPlan[]; canEditStays: boolean; canEditActivities: boolean;
  addMenu?: ReactNode; travelPath?: string; initialKind?: "all" | "stay" | "activity";
  savePin: (kind: "stay" | "activity", id: string, pin: PlacePin | null) => Promise<void>;
  /** Opens the stay's canonical record (any viewer). Edit stay stays organizer-only. */
  editStay: (id: string) => void; openStay?: (id: string) => void; openActivity: (id: string) => void;
}) {
  const places = useMemo(() => tripMapPlaces(stays, itinerary, commons.timezone), [stays, itinerary, commons.timezone]);
  const badges = useMemo(() => {
    let stay = 0, activity = 0;
    return new Map(places.map(place => [place.key, place.kind === "stay" ? String.fromCharCode(65 + (stay++ % 26)) : String(++activity)]));
  }, [places]);
  const [filter, setFilter] = useState<TripMapFilter>({ kind: initialKind, day: "any" });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [placing, setPlacing] = useState<{ key: string; point: Point | null; precision: PlacePin["precision"] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const detailHeading = useRef<HTMLHeadingElement>(null), mapColumn = useRef<HTMLDivElement>(null);
  const shown = filterTripMapPlaces(places, filter);
  const days = tripMapDays(commons.startsOn, commons.endsOn, places);
  const marked: MarkedPlace[] = shown.flatMap(place => place.pin ? [{ ...place, pin: place.pin, badge: badges.get(place.key) ?? "" }] : []);
  const selected = places.find(place => place.key === selectedKey) ?? null;
  const placingPlace = placing ? places.find(place => place.key === placing.key) ?? null : null;
  const canEdit = (place: TripMapPlace) => place.kind === "stay" ? canEditStays : canEditActivities;
  const compared = stayDistances(shown);
  const destination = commons.locationName ?? commons.locationNames?.[0] ?? "";
  const pick = useCallback((point: Point) => setPlacing(current => current ? { ...current, point } : current), []);

  function choose(key: string, fromMap = false) {
    if (placing) return;
    setSelectedKey(key);
    setMessage("");
    if (fromMap) requestAnimationFrame(() => detailHeading.current?.focus());
  }
  async function save(place: TripMapPlace, pin: PlacePin | null) {
    setBusy(true);
    setMessage("");
    try {
      await savePin(place.kind, place.id, pin);
      setPlacing(null);
      setMessage(pin ? `${place.name} is on the map.` : `${place.name} was removed from the map.`);
    } catch (error) {
      setMessage(personFacingError(error, "Location not saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const empty = places.length === 0;
  return <div className="product-view trip-map-view">
    <div className="view-intro event-page-header trip-map-intro">
      <div><h2>Map</h2></div>
      {addMenu}
    </div>
    {empty ? <p className="trip-map-empty">Add activity ideas and stay options. Maps and most venue links put them on the map; place the rest yourself.</p> : null}
    <div className="trip-map-layout">
      <div className="trip-map-main" ref={mapColumn}>
        <div className="trip-map-filters">
          <div className="trip-map-segments" role="group" aria-label="Show">
            {(["all", "stay", "activity"] as const).map(kind => <button key={kind} type="button" aria-pressed={filter.kind === kind}
              onClick={() => setFilter(current => ({ ...current, kind }))}>{kind === "all" ? "Everything" : kind === "stay" ? "Stays" : "Activities"}</button>)}
          </div>
          {filter.kind !== "stay" ? <label className="trip-map-day">Day
            <select value={filter.day} onChange={event => setFilter(current => ({ ...current, day: event.target.value }))}>
              <option value="any">Any day</option>
              <option value="undated">No day set</option>
              {days.map(day => <option key={day} value={day}>{dayLabel(day)}</option>)}
            </select>
          </label> : null}
        </div>
        {placing && placingPlace ? <div className="trip-map-placing" aria-label={`Place ${placingPlace.name} on the map`} role="group">
          <p role="status">{placing.point ? "Location chosen. Save it, or tap again to adjust." : `Tap the map where ${placingPlace.name} is, or move the map and choose Use map center.`}</p>
          {placingPlace.kind === "stay" ? <fieldset>
            <legend>This pin marks</legend>
            <label><input type="radio" name="trip-map-precision" checked={placing.precision === "exact"} onChange={() => setPlacing({ ...placing, precision: "exact" })} /> The exact place</label>
            <label><input type="radio" name="trip-map-precision" checked={placing.precision === "approximate"} onChange={() => setPlacing({ ...placing, precision: "approximate" })} /> An approximate area, like a rental without an address</label>
          </fieldset> : null}
          <div className="trip-map-actions">
            <button type="button" className="cm-action cm-action--primary" disabled={!placing.point || busy}
              onClick={() => placing.point && void save(placingPlace, { ...placing.point, precision: placing.precision, source: "placed" })}>{busy ? "Saving…" : "Save location"}</button>
            <button type="button" className="cm-action" disabled={busy} onClick={() => setPlacing(null)}>Cancel</button>
          </div>
        </div> : null}
        <TripMapCanvas destination={destination} places={marked} selectedKey={selectedKey} onSelect={key => choose(key, true)}
          draft={placing?.point ?? null} onPick={placing ? pick : undefined} />
      </div>
      <div className="trip-map-side">
        {message ? <p className="trip-map-message" role="status">{message}</p> : null}
        {selected ? <section className="trip-map-detail" aria-labelledby="trip-map-detail-title">
          <div className="trip-map-detail-heading">
            <h3 id="trip-map-detail-title" ref={detailHeading} tabIndex={-1}><span className={badgeClass(selected)} aria-hidden="true">{badges.get(selected.key)}</span>{selected.name}</h3>
            <button type="button" className="cm-action cm-action--quiet" disabled={Boolean(placing)} onClick={() => setSelectedKey(null)}>Close</button>
          </div>
          <p className="trip-map-meta">{selected.kind === "stay" ? "Stay" : "Activity"} · {selected.statusLabel}{selected.kind === "activity" ? ` · ${selected.day ? dayLabel(selected.day) : "No day set"}` : ""}</p>
          {selected.address ? <p>{selected.address}</p> : null}
          {selected.url ? <p><a href={selected.url} target="_blank" rel="noreferrer">Open link</a></p> : null}
          <p className="trip-map-meta">{placeLocationNote(selected)}</p>
          {placing?.key === selected.key ? <p className="trip-map-meta">Choosing a location on the map.</p> : <div className="trip-map-actions">
            {canEdit(selected) ? <button type="button" className="cm-action" disabled={busy || Boolean(placing)}
              onClick={() => {
                setPlacing({ key: selected.key, point: null, precision: selected.pin?.precision ?? (selected.kind === "stay" && isRentalListing(selected.url) ? "approximate" : "exact") });
                requestAnimationFrame(() => mapColumn.current?.scrollIntoView({ block: "start" }));
              }}>{selected.pin ? "Move pin" : "Place on map"}</button> : null}
            {canEdit(selected) && selected.pin ? <button type="button" className="cm-action cm-action--quiet" disabled={busy || Boolean(placing)} onClick={() => void save(selected, null)}>Remove pin</button> : null}
            {selected.kind === "stay" && openStay ? <button type="button" className="cm-action cm-action--quiet" onClick={() => openStay(selected.id)}>Open stay</button> : null}
            {selected.kind === "stay" && canEditStays ? <button type="button" className="cm-action cm-action--quiet" onClick={() => editStay(selected.id)}>Edit stay</button> : null}
            {selected.kind === "activity" ? <button type="button" className="cm-action cm-action--quiet" onClick={() => openActivity(selected.id)}>Open activity</button> : null}
          </div>}
          {selected.pin ? <PlaceDistances selected={selected} pin={selected.pin} shown={shown} badges={badges} /> : null}
        </section> : null}
        {compared.length > 0 && compared.some(row => row.activityCount) ? <section className="trip-map-compare" aria-labelledby="trip-map-compare-title">
          <h3 id="trip-map-compare-title">Stays and these activities</h3>
          <ul>{compared.map(row => <li key={row.stay.key}>
            <button type="button" aria-pressed={row.stay.key === selectedKey} onClick={() => choose(row.stay.key)}>
              <span className={badgeClass(row.stay)} aria-hidden="true">{badges.get(row.stay.key)}</span>
              <span><strong>{row.stay.name}</strong><small>{row.nearestKm === null || row.farthestKm === null
                ? row.stay.pin ? "No activities shown are on the map yet." : "Not on the map yet."
                : `${distanceLabel(row.nearestKm)} to ${distanceLabel(row.farthestKm)} from ${row.distances.length} ${row.distances.length === 1 ? "activity" : "activities"}${row.stay.pin?.precision === "approximate" ? " · from an approximate area" : ""}`}</small></span>
            </button>
          </li>)}</ul>
          <p className="trip-map-meta">Straight-line distance, not drive time.{compared[0] && compared[0].unplacedCount ? ` ${compared[0].unplacedCount} of these activities ${compared[0].unplacedCount === 1 ? "isn’t" : "aren’t"} on the map yet.` : ""}</p>
        </section> : null}
        {filter.kind !== "activity" && transport.length && travelPath ? <p className="trip-map-meta">Vans, rental cars, and rides are in <a href={travelPath}>{planTemplateFor(commons.templateKey).planSections.travel.label}</a>.</p> : null}
        {(["stay", "activity"] as const).map(kind => {
          const rows = shown.filter(place => place.kind === kind);
          if (!rows.length) return null;
          return <section key={kind} className="trip-map-list" aria-labelledby={`trip-map-${kind}-title`}>
            <h3 id={`trip-map-${kind}-title`}>{kind === "stay" ? "Stays" : "Activities"}</h3>
            <ul>{rows.map(place => <li key={place.key}>
              <button type="button" aria-pressed={place.key === selectedKey} disabled={Boolean(placing) && placing?.key !== place.key} onClick={() => choose(place.key)}>
                <span className={badgeClass(place)} aria-hidden="true">{badges.get(place.key)}</span>
                <span><strong>{place.name}</strong><small>{place.statusLabel}{place.kind === "activity" ? ` · ${place.day ? dayLabel(place.day) : "No day set"}` : ""}{place.pin ? place.pin.precision === "approximate" ? " · Approximate area" : "" : " · Not on the map"}</small></span>
              </button>
            </li>)}</ul>
          </section>;
        })}
      </div>
    </div>
  </div>;
}

function PlaceDistances({ selected, pin, shown, badges }: { selected: TripMapPlace; pin: PlacePin; shown: TripMapPlace[]; badges: Map<string, string> }) {
  const others = shown.filter(place => place.kind !== selected.kind && place.pin)
    .map(place => ({ place, km: distanceKm(pin, place.pin!), link: selected.kind === "stay" ? directionsUrl(pin, place.pin!) : directionsUrl(place.pin!, pin) }))
    .sort((a, b) => a.km - b.km);
  if (!others.length) return null;
  return <div className="trip-map-distances">
    <h4>{selected.kind === "stay" ? "Activities from here" : "Stays from here"}</h4>
    <ul>{others.map(({ place, km, link }) => {
      return <li key={place.key}><span><span className={badgeClass(place)} aria-hidden="true">{badges.get(place.key)}</span>{place.name}</span>
        <span>{distanceLabel(km)}{link ? <> · <a href={link} target="_blank" rel="noreferrer">Directions</a></> : null}</span></li>;
    })}</ul>
    <p className="trip-map-meta">Straight-line distance.{others.some(other => other.link) ? " Directions open in Google Maps." : ""}</p>
  </div>;
}

const badgeClass = (place: Pick<TripMapPlace, "kind">) => `trip-map-badge${place.kind === "stay" ? " trip-map-badge--stay" : ""}`;
