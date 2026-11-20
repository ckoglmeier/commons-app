"use client";
import { useEffect, useState } from "react";
import type { LocationTimezoneMatch } from "@/lib/location-timezone";
export function LocationTimezoneField({ value, onChange, label = "Timezone", initialQuery = "" }: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery), [source, setSource] = useState("");
  const [result, setResult] = useState<{ query: string; matches: LocationTimezoneMatch[]; error?: string } | null>(null);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/location-timezones/?q=${encodeURIComponent(query)}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Location search is unavailable. Enter the timezone below.");
        if (!controller.signal.aborted) setResult({ query, matches: data.matches });
      } catch {
        if (!controller.signal.aborted) setResult({ query, matches: [], error: "Location search is unavailable. Enter the timezone below." });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  const active = result?.query === query ? result : null;
  return <div className="location-timezone-field"><label className="field"><span>Find timezone by city or airport</span><input value={query} maxLength={120} placeholder="San Francisco or SFO" onChange={event => setQuery(event.target.value)} /></label>
    {query.trim().length >= 2 ? <div aria-label="Matching locations" aria-busy={!active}>
      {active?.matches.map(match => <button key={match.id} className="cm-action" type="button" onClick={() => { onChange(match.timezone); setSource(match.label); setQuery(""); }}>{match.label} · {match.timezone}</button>)}
      <p className="expense-mode-help" role="status">{!active ? "Finding locations…" : active.error ?? (!active.matches.length ? "No matching location. Try a nearby city or enter the timezone below." : "Choose the city or airport you mean.")}</p>
      <a className="timezone-data-source" href="https://www.geonames.org/" target="_blank" rel="noreferrer">City data: GeoNames</a>
    </div> : null}
    <label className="field"><span>{label} <small>If known</small></span><input value={value} maxLength={80} placeholder="America/Los_Angeles" onChange={event => { setSource(""); onChange(event.target.value); }} /></label>{source ? <p className="expense-mode-help">Timezone from {source}</p> : null}
  </div>;
}
