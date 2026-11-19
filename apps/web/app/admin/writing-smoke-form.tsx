"use client";

import { useState } from "react";
import { runPrivateWritingSmoke } from "./actions";

type Result = { title: string; label: "A" | "B"; text: string; checks: string[] };

export function WritingSmokeForm() {
  const [pending, setPending] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [state, setState] = useState<{ error: boolean; message: string; results: Result[]; models: Record<"A" | "B", string> | null } | null>(null);
  async function run() {
    setPending(true); setReveal(false);
    setState(await runPrivateWritingSmoke());
    setPending(false);
  }
  return <div className="operator-writing-smoke">
    <p>Runs four fixed, de-identified briefs against the current Workspace model and Gemini 3.6 Flash. It does not read a trip, send email, or change Commons.</p>
    <button type="button" onClick={run} disabled={pending}>{pending ? "Running comparison…" : "Run private writing comparison"}</button>
    {state ? <div className="operator-writing-result" role={state.error ? "alert" : "status"}>
      <p>{state.message}</p>
      {state.results.length ? <><div className="operator-writing-grid">{state.results.map(result => <article key={`${result.title}-${result.label}`}><span>{result.title} · Candidate {result.label}</span><p>{result.text}</p><small>{result.checks.join(" · ")}</small></article>)}</div><button className="secondary" type="button" onClick={() => setReveal(value => !value)}>{reveal ? "Hide model labels" : "Reveal model labels"}</button>{reveal && state.models ? <p className="operator-writing-labels">Candidate A: {state.models.A}<br />Candidate B: {state.models.B}</p> : null}</> : null}
    </div> : null}
  </div>;
}
