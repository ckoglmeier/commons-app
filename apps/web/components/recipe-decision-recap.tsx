"use client";
import { useState } from "react";
import Link from "next/link";
import type { RecipeRunDetail } from "@commons/contracts";

export function RecipeDecisionRecap({ run }: { run: RecipeRunDetail }) {
  const [copied, setCopied] = useState(false), [fallback, setFallback] = useState(""), decision = run.participantDecision;
  if (!decision || run.outcome?.status === "superseded") return null;
  const path = `/c/poll/${decision.publicId}`;
  async function copy() {
    const recap = `${decision!.summary}\n\n${window.location.origin}${path}`;
    try { await navigator.clipboard.writeText(recap); setCopied(true); setFallback(""); }
    catch { setCopied(false); setFallback(recap); }
  }
  return <section className="recipe-section" aria-label="Share the decision"><h2>Here’s what was decided</h2><p>{decision.summary}</p>
    {run.outcome?.stale.length || run.context?.changed ? <p className="recipe-attention">Review the changed context before sharing this earlier decision.</p> : <><div className="poll-action-row"><button type="button" className="cm-action" onClick={copy}>Copy decision recap</button><span role="status" aria-live="polite" aria-atomic="true">{copied ? "Copied" : ""}</span><Link className="cm-action cm-action--link" href={path}>Open the participant view</Link></div>
      {fallback ? <label className="fieldnotes-field"><span>Couldn’t copy automatically. Select and copy this recap.</span><textarea readOnly rows={4} value={fallback} onFocus={event => event.currentTarget.select()} /></label> : null}</>}
    <p className="recipe-note">Keeps this poll’s existing access. Copying doesn’t send it.</p>
  </section>;
}
