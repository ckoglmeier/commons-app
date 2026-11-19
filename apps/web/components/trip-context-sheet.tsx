"use client";
import { useEffect, useState } from "react";
import { TripPlanningContextStateSchema, type TripPlanningContextState } from "@commons/contracts";
import { ModalLayer } from "./modal-layer";
import { CloseIcon } from "./icons";
import { TripContextEditor } from "./trip-context-editor";
import "./trip-context-editor.css";

export function TripContextSheet({ tripId, close }: { tripId: string; close: () => void }) {
  const [context, setContext] = useState<TripPlanningContextState | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/v1/commons/${encodeURIComponent(tripId)}/context/`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Trip context could not be loaded.");
        if (!controller.signal.aborted) setContext(TripPlanningContextStateSchema.parse(body));
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Trip context could not be loaded."); }
    })();
    return () => controller.abort();
  }, [tripId, attempt]);
  return <ModalLayer close={close}><section className="sheet" role="dialog" aria-modal="true" aria-labelledby="trip-context-title">
    <header className="sheet-header"><h2 id="trip-context-title">Trip context</h2><button type="button" onClick={close} aria-label="Close trip context"><CloseIcon /></button></header>
    {context ? <TripContextEditor initial={context} /> : error ? <><p role="alert">{error}</p><button type="button" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Try again</button></> : <p role="status">Loading trip context…</p>}
  </section></ModalLayer>;
}
