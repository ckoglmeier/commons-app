"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { recipeCatalog, recipeEntry, recipeStageLabels, type PollWorkingDraft, type RecipeRunSummary } from "@commons/contracts";
import { recipeRequest } from "@/lib/recipe-client";
import { RecipeDraftDelete } from "./recipe-draft-delete";

type Guided = "dates_location" | "attendance" | "lodging" | "food_preferences";
const guided: Guided[] = ["dates_location", "attendance", "lodging", "food_preferences"];
const pollRecipes = recipeCatalog.filter(item => item.handler === "poll_draft");
const isGuided = (value: string | null): value is Guided => guided.includes(value as Guided);

type SavedPoll = { id: string; publicId: string; title: string; status: "open" | "closed"; responded: boolean; canManage: boolean; itinerary?: boolean; superseded?: boolean };

export function RecipeStart({ slug, runs, pollDrafts = [], polls = [], initial, view = "new" }: { slug: string; runs: RecipeRunSummary[]; pollDrafts?: PollWorkingDraft[]; polls?: SavedPoll[]; initial?: string | null; view?: string }) {
  const [selected, setSelected] = useState<Guided | null>(isGuided(initial ?? null) ? initial as Guided : null);
  const [page, setPage] = useState(0);
  const groups = {
    drafts: runs.filter(r => !r.archived && r.stage === "draft"),
    shared: runs.filter(r => !r.archived && ["shared", "collecting", "decide"].includes(r.stage)),
    completed: runs.filter(r => !r.archived && ["decided", "applied", "closed"].includes(r.stage)),
    deleted: runs.filter(r => r.archived),
  };
  const current = Object.hasOwn(groups, view) ? view as keyof typeof groups : "new";
  const items = current === "new" ? [] : groups[current], pageCount = Math.max(1, Math.ceil(items.length / 8)), activePage = Math.min(page, pageCount - 1);
  const runPollIds = new Set(runs.flatMap(run => run.pollId ? [run.pollId] : []));
  const runDraftIds = new Set(runs.flatMap(run => run.draftId ? [run.draftId] : []));
  const genericDrafts = pollDrafts.filter(draft => !draft.archivedAt && !draft.publishedPollId && !draft.runId && !runDraftIds.has(draft.id));
  const genericShared = polls.filter(poll => !runPollIds.has(poll.id) && poll.status === "open" && !poll.superseded);
  const genericCompleted = polls.filter(poll => !runPollIds.has(poll.id) && (poll.status === "closed" || poll.superseded));
  const savedItems = current === "drafts" ? genericDrafts.length : current === "shared" ? genericShared.length : current === "completed" ? genericCompleted.length : 0;
  const viewCounts = { new: 0, drafts: groups.drafts.length + genericDrafts.length, shared: groups.shared.length + genericShared.length, completed: groups.completed.length + genericCompleted.length };
  if (selected) return <OpenRecipeDraft key={selected} slug={slug} recipe={selected} />;
  return <>
    <div className="poll-organizer-intro poll-page-heading"><h1>Ask the group</h1></div>
    <nav className="recipe-navigation" aria-label="Ask the group views">{(["new", "drafts", "shared", "completed"] as const).map(key => <Link key={key} href={`/c/${encodeURIComponent(slug)}/ask?view=${key}`} aria-current={current === key ? "page" : undefined}>{key === "new" ? "New" : `${key[0].toUpperCase()}${key.slice(1)} (${viewCounts[key]})`}</Link>)}</nav>
    {current !== "new" ? <section className="recipe-section"><h2>{current === "deleted" ? "Deleted drafts" : current[0].toUpperCase() + current.slice(1)}</h2>
      {!items.length && !savedItems ? <p>Nothing here yet.</p> : null}
      {current === "drafts" && genericDrafts.length ? <><h3>Poll drafts</h3><ul className="recipe-run-list">{genericDrafts.map(draft => <li key={draft.id}><Link href={`/c/${encodeURIComponent(slug)}/polls/new?draft=${draft.id}`}><strong>{draft.data.title || "Untitled poll"}</strong><small>{draft.data.sourcePollId ? "Follow-up poll · " : "Draft poll · "}Continue editing</small></Link></li>)}</ul></> : null}
      {(current === "shared" || current === "completed") && savedItems ? <><h3>{current === "shared" ? "Shared polls" : "Completed polls"}</h3><ul className="recipe-run-list">{(current === "shared" ? genericShared : genericCompleted).map(poll => <li key={poll.id}><Link href={poll.canManage ? `/c/${encodeURIComponent(slug)}/polls/${poll.id}` : `/c/poll/${poll.publicId}`}><strong>{poll.title || "Untitled poll"}</strong><small>{poll.status === "closed" || poll.superseded ? "Closed · View poll" : poll.responded ? "Shared · Your response is saved" : "Shared · Voting open"}</small></Link></li>)}</ul></> : null}
      {items.length ? <><h3>{current === "deleted" ? "Deleted guided drafts" : "Guided asks"}</h3><ul className="recipe-run-list">{items.slice(activePage * 8, activePage * 8 + 8).map(run => <li key={run.id}>
        {run.archived ? <div className="recipe-deleted-title"><strong>{run.title}</strong><small>{recipeEntry(run.recipe).title}</small></div> : <Link href={`/c/${encodeURIComponent(slug)}/recipes/${run.id}`}><strong>{run.title}</strong><small>{recipeEntry(run.recipe).title} · {recipeStageLabels[run.stage]}{run.pollId ? ` · ${run.responseCount} ${run.responseCount === 1 ? "answer" : "answers"}` : ""}{run.rounds > 1 ? ` · Round ${run.rounds}` : ""}</small>{run.stale.length ? <small className="recipe-stale">Worth another look: {run.stale.map(s => s.message).join(" ")}</small> : null}</Link>}
        {run.canDelete && run.draftVersion ? <RecipeDraftDelete slug={slug} runId={run.id} version={run.draftVersion} title={run.title} archived={run.archived} /> : null}
      </li>)}</ul></> : null}
      {pageCount > 1 ? <div className="recipe-navigation"><button className="cm-action" disabled={!activePage} onClick={() => setPage(activePage - 1)}>Previous</button><span>Page {activePage + 1} of {pageCount}</span><button className="cm-action" disabled={activePage === pageCount - 1} onClick={() => setPage(activePage + 1)}>Next</button></div> : null}
    </section> : <section className="recipe-section"><h2>Start something new</h2><ul className="recipe-menu">{pollRecipes.map(item => <li key={item.id}>{guided.includes(item.id as Guided)
      ? <button type="button" className="cm-action" onClick={() => setSelected(item.id as Guided)}><strong>{item.title}</strong><small>{item.summary}</small></button>
      : <Link className="cm-action" href={`/c/${encodeURIComponent(slug)}/polls/new`}><strong>{item.title}</strong><small>{item.summary}</small></Link>}</li>)}</ul></section>
    }
    <div className="recipe-back"><Link href={`/c/${encodeURIComponent(slug)}/ask?view=deleted`} aria-current={current === "deleted" ? "page" : undefined}>Deleted drafts ({groups.deleted.length})</Link></div>
  </>;
}

function OpenRecipeDraft({ slug, recipe }: { slug: string; recipe: Guided }) {
  const router = useRouter(), command = useRef<{ commandId: string; runId: string; draftId: string } | null>(null);
  const [error, setError] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    command.current ??= { commandId: crypto.randomUUID(), runId: crypto.randomUUID(), draftId: crypto.randomUUID() };
    let active = true;
    void recipeRequest<{ runId: string; goalId?: string }>(`/api/v1/commons/${encodeURIComponent(slug)}/recipes`, "POST", { ...command.current, recipe }).then(result => {
      if (!active) return;
      if (result.ok) router.replace(result.data.goalId ? `/c/${encodeURIComponent(slug)}/goals/${result.data.goalId}` : `/c/${encodeURIComponent(slug)}/recipes/${result.data.runId}`);
      else setError(result.error);
    });
    return () => { active = false; };
  }, [slug, recipe, router, attempt]);
  return <div role="status">{error ? <><p>{error}</p><button type="button" className="cm-action" onClick={() => { setError(null); setAttempt(n => n + 1); }}>Try again</button></> : "Opening your draft…"}</div>;
}
