"use client";
import { useEffect, useState } from "react";
import type { MapCity } from "../lib/map-city";

export function useMapCity(destination: string, enabled: boolean) {
  const [search, setSearch] = useState({ destination, query: destination, attempt: 0 });
  const query = search.destination === destination ? search.query : destination;
  const [result, setResult] = useState<{ destination: string; query: string; matches: MapCity[]; error?: string } | null>(null);
  const [choice, setChoice] = useState<{ destination: string; query: string; city: MapCity } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetch(`/api/v1/map-cities/?q=${encodeURIComponent(query.slice(0, 120))}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("City lookup unavailable");
        const data = await response.json();
        if (!controller.signal.aborted) setResult({ destination, query, matches: data.matches });
      }).catch(() => {
        if (!controller.signal.aborted) setResult({ destination, query, matches: [], error: "City lookup is unavailable. Your places remain on the map and in the list." });
      });
    return () => controller.abort();
  }, [enabled, destination, query, search.attempt]);
  const active = result?.destination === destination && result.query === query ? result : null;
  const city = choice?.destination === destination && choice.query === query ? choice.city : active?.matches.length === 1 ? active.matches[0] : null;
  return { city, query, matches: active?.matches ?? [], loading: enabled && !active, error: active?.error,
    find: (value: string) => { setChoice(null); setResult(null); setSearch(v => ({ destination, query: value.trim(), attempt: v.attempt + 1 })); },
    choose: (city: MapCity) => setChoice({ destination, query, city }) };
}
