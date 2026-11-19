"use client";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { cityMapZoom, cityRelativeLongitude } from "../lib/map-city";
import type { TripMapPlace } from "../lib/trip-map";
import { useMapCity } from "./use-map-city";

export type MarkedPlace = TripMapPlace & { pin: NonNullable<TripMapPlace["pin"]>; badge: string };
type Point = { latitude: number; longitude: number };
type Instance = { L: typeof Leaflet; map: Leaflet.Map; layers: Leaflet.LayerGroup; markers: Map<string, Leaflet.Marker> };

/** Starts at the trip's reported city, then widens to every shown pin. Tile
 * requests carry only the viewed area; place names and notes stay in Commons. */
export function TripMapCanvas({ destination, places, selectedKey, onSelect, draft, onPick }: {
  destination: string; places: MarkedPlace[]; selectedKey: string | null; onSelect: (key: string) => void;
  draft: Point | null; onPick?: (point: Point) => void;
}) {
  const cityLookup = useMapCity(destination, Boolean(destination));
  const city = cityLookup.city;
  const container = useRef<HTMLDivElement>(null), instance = useRef<Instance | null>(null), select = useRef(onSelect), selected = useRef(selectedKey);
  const [revision, setRevision] = useState(0), [problem, setProblem] = useState("");
  const mapped = places.map(place => city ? { ...place, pin: { ...place.pin, longitude: cityRelativeLongitude(place.pin.longitude, city.longitude) } } : place);
  // Placed pins show at once; the city lookup then re-centers the same map.
  const ready = mapped.length > 0 || (!cityLookup.loading && Boolean(city)), pointKey = JSON.stringify(mapped), cityKey = JSON.stringify(city);
  useEffect(() => { select.current = onSelect; }, [onSelect]);
  useEffect(() => {
    if (!ready || !container.current) return;
    let disposed = false;
    const element = container.current;
    void import("leaflet").then(L => {
      if (disposed) return;
      const map = L.map(element, { zoomControl: false, attributionControl: false, scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false,
        markerZoomAnimation: false, inertia: false, minZoom: 2, maxZoom: 18 });
      instance.current = { L, map, layers: L.layerGroup().addTo(map), markers: new Map() };
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, keepBuffer: 0, updateWhenIdle: true, referrerPolicy: "origin" })
        .on("tileerror", () => { if (!disposed) setProblem("Some map tiles couldn’t load. Every place is still in the list."); }).addTo(map);
      const resize = new ResizeObserver(() => { if (!disposed) map.invalidateSize({ animate: false, pan: false }); });
      resize.observe(element);
      map.once("unload", () => resize.disconnect());
      setRevision(value => value + 1);
    }).catch(() => { if (!disposed) setProblem("The map couldn’t open. Every place is still in the list."); });
    return () => { disposed = true; instance.current?.map.remove(); instance.current = null; };
  }, [ready]);
  function fit() {
    const current = instance.current;
    if (!current) return;
    const pins: MarkedPlace[] = JSON.parse(pointKey), center: typeof city = JSON.parse(cityKey);
    if (center) current.map.setView([center.latitude, center.longitude], cityMapZoom(center, pins.map(place => place.pin), current.map.getSize()), { animate: false });
    else if (pins.length) current.map.fitBounds(current.L.latLngBounds(pins.map(place => [place.pin.latitude, place.pin.longitude] as [number, number])), { padding: [44, 44], maxZoom: 14, animate: false });
  }
  useEffect(() => {
    const current = instance.current;
    if (!current) return;
    const { L, layers, markers } = current;
    const pins: MarkedPlace[] = JSON.parse(pointKey);
    // Leaflet renders markers only once the map has a view.
    fit();
    const draw = () => {
      layers.clearLayers(); markers.clear();
      // Places closer than a marker's width share one marker until zoomed in.
      const groups: { places: MarkedPlace[]; x: number; y: number }[] = [];
      for (const place of pins) {
        const point = current.map.latLngToLayerPoint([place.pin.latitude, place.pin.longitude]);
        const group = groups.find(entry => Math.hypot(entry.x - point.x, entry.y - point.y) < 36);
        if (group) group.places.push(place); else groups.push({ places: [place], x: point.x, y: point.y });
      }
      for (const group of groups) {
        const [place] = group.places, many = group.places.length > 1;
        const describe = (entry: MarkedPlace) => `${entry.badge}. ${entry.name} · ${entry.kind === "stay" ? "Stay" : "Activity"} · ${entry.statusLabel}${entry.pin.precision === "approximate" ? " · Approximate area" : ""}`;
        const label = many ? `${group.places.length} places close together: ${group.places.map(describe).join("; ")}. Zoom in to separate them.` : describe(place);
        // Badges are only letters and numbers; names stay out of the markup.
        const text = many ? group.places.map(entry => entry.badge).join(" ") : place.badge;
        const icon = L.divIcon({ className: "trip-map-marker", iconSize: [44, 44], iconAnchor: [22, 22],
          html: `<span class="trip-map-pin trip-map-pin--${many ? "group" : place.kind}${!many && place.pin.precision === "approximate" ? " is-area" : ""}" aria-hidden="true">${text.replace(/[^A-Z0-9 ]/g, "")}</span>` });
        const marker = L.marker(current.map.layerPointToLatLng([group.x, group.y]), { keyboard: true, title: label, icon, riseOnHover: true });
        marker.on("add", () => {
          const element = marker.getElement();
          element?.setAttribute("role", "button");
          element?.setAttribute("aria-label", label);
          const isSelected = group.places.some(entry => entry.key === selected.current);
          element?.setAttribute("aria-pressed", String(isSelected));
          element?.classList.toggle("is-selected", isSelected);
        });
        marker.on("click", () => {
          if (!many) return select.current(place.key);
          current.map.fitBounds(L.latLngBounds(group.places.map(entry => [entry.pin.latitude, entry.pin.longitude] as [number, number])), { padding: [60, 60], maxZoom: 18, animate: false });
        });
        marker.addTo(layers);
        for (const entry of group.places) markers.set(entry.key, marker);
      }
    };
    draw();
    current.map.on("zoomend", draw);
    return () => { current.map.off("zoomend", draw); };
    // fit reads the same serialized inputs as this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointKey, cityKey, revision]);
  useEffect(() => {
    const current = instance.current;
    selected.current = selectedKey;
    if (!current) return;
    for (const marker of new Set(current.markers.values())) {
      const isSelected = [...current.markers].some(([key, entry]) => entry === marker && key === selectedKey);
      marker.getElement()?.classList.toggle("is-selected", isSelected);
      marker.getElement()?.setAttribute("aria-pressed", String(isSelected));
    }
    const marker = selectedKey ? current.markers.get(selectedKey) : undefined;
    if (marker && !current.map.getBounds().pad(-0.1).contains(marker.getLatLng())) current.map.panTo(marker.getLatLng(), { animate: false });
  }, [selectedKey, revision]);
  useEffect(() => {
    const current = instance.current;
    if (!current || !onPick) return;
    const pick = (event: Leaflet.LeafletMouseEvent) => onPick({ latitude: event.latlng.lat, longitude: cityRelativeLongitude(event.latlng.lng, 0) });
    current.map.on("click", pick);
    current.map.getContainer().classList.add("is-picking");
    return () => { current.map.off("click", pick); current.map.getContainer().classList.remove("is-picking"); };
  }, [onPick, revision]);
  useEffect(() => {
    const current = instance.current;
    if (!current || !draft) return;
    const tokens = getComputedStyle(current.map.getContainer());
    const marker = current.L.circleMarker([draft.latitude, city ? cityRelativeLongitude(draft.longitude, city.longitude) : draft.longitude], {
      radius: 11, color: tokens.getPropertyValue("--cm-color-ember").trim(), fillColor: tokens.getPropertyValue("--cm-color-coral-wash").trim(),
      weight: 3, fillOpacity: 0.9, interactive: false,
    }).addTo(current.map);
    return () => { marker.remove(); };
  }, [draft, city, revision]);
  const status = cityLookup.loading ? `Finding ${cityLookup.query}…` : city ? `Centered on ${city.label}`
    : cityLookup.matches.length > 1 ? `Which ${cityLookup.query} is this trip in?` : destination ? `Couldn’t find ${destination} on the map.` : "";
  return <section className="trip-map-canvas" aria-label="Map">
    <div className="trip-map-controls">
      <button type="button" className="cm-action cm-action--quiet" disabled={!revision} onClick={() => instance.current?.map.zoomIn()}>Zoom in</button>
      <button type="button" className="cm-action cm-action--quiet" disabled={!revision} onClick={() => instance.current?.map.zoomOut()}>Zoom out</button>
      <button type="button" className="cm-action cm-action--quiet" disabled={!revision} onClick={fit}>Show all</button>
      {onPick ? <button type="button" className="cm-action cm-action--quiet" disabled={!revision} onClick={() => {
        const center = instance.current?.map.getCenter();
        if (center) onPick({ latitude: center.lat, longitude: cityRelativeLongitude(center.lng, 0) });
      }}>Use map center</button> : null}
    </div>
    {status ? <p className="trip-map-note" role="status">{status}</p> : null}
    {!city && cityLookup.matches.length > 1 ? <div className="trip-map-controls" aria-label="Choose the trip’s city">
      {cityLookup.matches.slice(0, 6).map(match => <button key={match.id} type="button" className="cm-action" onClick={() => cityLookup.choose(match)}>{match.label}</button>)}
    </div> : null}
    {ready ? <div ref={container} className="trip-map-surface" role="region" aria-label="Map of placed stays and activities" />
      : !cityLookup.loading ? <p className="trip-map-note">Place something on the map or set the trip’s city to see a map.</p> : null}
    {problem ? <p className="trip-map-note" role="status">{problem}</p> : null}
    {ready ? <p className="trip-map-note">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>{city ? <> · City data <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a></> : null}. OpenStreetMap sees the area you view, not your trip details.</p> : null}
  </section>;
}
