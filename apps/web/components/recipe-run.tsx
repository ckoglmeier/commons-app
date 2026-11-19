"use client";

import Link from "next/link";
import { FoodRecipe } from "./recipe-food";
import { RecipeDraftDelete } from "./recipe-draft-delete";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { recipeEntry, type RecipeRunDetail } from "@commons/contracts";
import { recipeRequest } from "@/lib/recipe-client";
import { type Act, type Call } from "./recipe-shared";
import { GuidedGoalStages } from "./guided-goal-stages";

export function RecipeRun({ slug, initial, onRefresh, embedded = false, goalBuild, goalDecide }: { slug: string; initial: RecipeRunDetail; onRefresh?: (run: RecipeRunDetail) => void; embedded?: boolean; goalBuild?: ReactNode; goalDecide?: ReactNode }) {
  const [run, setRun] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [draftEpoch, setDraftEpoch] = useState(0), [draftDirty, setDraftDirty] = useState(false);
  const refreshGeneration = useRef(0);
  const base = `/api/v1/commons/${encodeURIComponent(slug)}`, runBase = `${base}/recipes/${run.id}`;
  const reload = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const result = await recipeRequest<{ run: RecipeRunDetail }>(`${base}/recipes/${initial.id}`, "GET");
    if (generation !== refreshGeneration.current) return false;
    if (result.ok) { setRun(result.data.run); onRefresh?.(result.data.run); } else setError(result.error);
    return result.ok;
  }, [base, initial.id, onRefresh]);
  const call: Call = useCallback(async (path, method, body) => recipeRequest(path, method, body), []);
  useEffect(() => {
    if (!run.poll || run.poll.status !== "open" || run.poll.superseded || run.stage === "draft" || run.stage === "closed" || busy) return;
    const update = () => { if (document.visibilityState === "visible") void reload(); };
    const timer = window.setInterval(update, 15_000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [run.poll, run.stage, busy, reload]);
  const act: Act = async (work, done) => {
    ++refreshGeneration.current;
    setBusy(true); setError(null); setNotice(null);
    const result = await work();
    if (result && !result.ok) {
      setError(result.error ?? "Commons couldn’t confirm the result. Reload the saved workflow before trying again.");
      if (result.code === "conflict" || result.code === "trip_changed" || result.code === "superseded") await reload();
    } else { const refreshed = await reload(); if (refreshed) { setDraftEpoch(current => current + 1); setDraftDirty(false); } if (done) setNotice(done); }
    setBusy(false);
  };
  const common = { busy, act, call, runBase }, entry = recipeEntry(run.recipe);
  if (!run.draft.archived) return <article className="recipe-run" aria-label={entry.title}>
    <div className="recipe-messages" aria-live="polite">{error ? <p className="recipe-error" role="alert">{error}</p> : null}{notice ? <p className="recipe-notice" role="status">{notice}</p> : null}</div>
    {!embedded ? <h1>{run.title}</h1> : null}
    {run.recipe === "food_preferences" ? <FoodRecipe key={`${run.draft.id}:${draftEpoch}`} slug={slug} run={run} goal={goalBuild} {...common} /> : <GuidedGoalStages slug={slug} run={run} goalBuild={goalBuild} goalDecide={goalDecide} draftEpoch={draftEpoch} draftDirty={draftDirty} onDirtyChange={setDraftDirty} {...common} />}
    {run.stage === "draft" && !run.history.length ? <RecipeDraftDelete slug={slug} runId={run.id} version={run.draft.version} title={run.title} leave /> : null}
  </article>;
  return <article className="recipe-run"><section className="recipe-section"><h1>Deleted draft</h1><p>{run.title}</p><RecipeDraftDelete slug={slug} runId={run.id} version={run.draft.version} title={run.title} archived /><Link href={`/c/${encodeURIComponent(slug)}/ask?view=deleted`}>Back to deleted drafts</Link></section></article>;
}
