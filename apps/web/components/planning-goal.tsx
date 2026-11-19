"use client";

import Link from "next/link";
import { useState } from "react";
import type { CoordinatorGoal, RecipeRunDetail } from "@commons/contracts";
import { GoalTaskDetails, useGoalWorkspace, type GoalController } from "./coordinator-goals";
import { RecipeRun } from "./recipe-run";
import { goalDecisionPrompt } from "@/lib/goal-decision-prompt";

/** One Goal, one existing workflow. No copied drafts, polls or Plan state. */
export function PlanningGoal({ slug, actorId, initialGoal, initialRun, conversationAvailable = true }: { slug: string; actorId: string; initialGoal: CoordinatorGoal; initialRun: RecipeRunDetail; /** False on a beta trip: no Build with Coordinator link; the goal's own controls follow the work. */ conversationAvailable?: boolean }) {
  const controller = useGoalWorkspace(slug, actorId, true, { goals: [initialGoal], reports: [] });
  const goal = controller.goals.find(item => item.goalId === initialGoal.goalId) ?? initialGoal;
  const [run, setRun] = useState(initialRun);
  const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const refreshWork = (updated: RecipeRunDetail) => {
    setRun(updated);
    void controller.refresh().then(() => setRefreshError("")).catch(() => setRefreshError("Poll saved. The Goal status couldn’t refresh; reload to see its latest state."));
  };
  const terminal = ["completed", "cancelled", "failed"].includes(goal.lifecycle);
  const prompt = !conversationAvailable && !terminal ? goalDecisionPrompt(run) : null;
  return <>
    <nav className="workspace-actions" aria-label="Goal navigation"><Link className="cm-action" href={`/c/${slug}/goals`}>All goals</Link></nav>
    <header className="poll-organizer-intro poll-page-heading"><h1>{goal.title}</h1></header>
    {terminal ? <p className="recipe-note" role="status">{goal.lifecycle === "completed" ? run.recipe === "food_preferences" ? "Food collection finished. Saved answers remain available for advice." : "Goal completed." : goal.lifecycle === "cancelled" ? "Goal cancelled. Saved polls and trip details remain unchanged." : "Goal work failed. Saved polls and trip details remain unchanged."}</p> : null}
    {controller.error ? <p role="alert" className="cm-note">{controller.error}</p> : null}
    {refreshError ? <p role="alert" className="cm-note">{refreshError}</p> : null}
    {prompt ? <section className="recipe-section" role="status" aria-label="Decision needed"><h2>{prompt.heading}</h2><p>{prompt.message}</p></section> : null}
    <RecipeRun slug={slug} initial={initialRun} onRefresh={refreshWork} embedded
      goalBuild={<PlanningGoalObjective goal={goal} controller={controller} draft={goalDraft} onChange={setGoalDraft} showCriterion={run.recipe !== "food_preferences"} conversationAvailable={conversationAvailable} />}
      goalDecide={run.recipe !== "food_preferences" && !terminal && goal.ownedByMe && run.outcome && ["approved", "applied"].includes(run.outcome.status) ? <section className="recipe-section" aria-label="Review goal outcome"><h3>Does this outcome meet the goal?</h3><p>{goal.goal}</p><p className="recipe-note">Finish line: {goal.completionCriterion}</p><p>Completing this goal does not update the Plan.</p><button type="button" className="cm-action cm-action--primary" disabled={controller.pending || run.outcome.stale.length > 0} onClick={() => void controller.operate({ op: "accept_outcome", goalId: goal.goalId, expectedRevision: goal.revision, outcomeId: run.outcome!.id })}>This outcome meets the goal</button></section> : null} />
    {conversationAvailable ? null : <GoalTaskDetails goal={goal} controller={controller} polls={[]} turns={[]} showWorkLink={false} conversationAvailable={false} />}
  </>;
}

/** A goal with no planning workflow (for example a poll-collection goal) on a trip without a conversation: its own controls, in place of a redirect into Coordinator. */
export function DirectGoal({ slug, actorId, initialGoal, polls }: { slug: string; actorId: string; initialGoal: CoordinatorGoal; polls: Array<{ id: string; title: string }> }) {
  const controller = useGoalWorkspace(slug, actorId, true, { goals: [initialGoal], reports: [] });
  const goal = controller.goals.find(item => item.goalId === initialGoal.goalId) ?? initialGoal;
  return <>
    <nav className="workspace-actions" aria-label="Goal navigation"><Link className="cm-action" href={`/c/${slug}/goals`}>All goals</Link></nav>
    <header className="poll-organizer-intro poll-page-heading"><h1>{goal.title}</h1></header>
    {controller.error ? <p role="alert" className="cm-note">{controller.error}</p> : null}
    <GoalTaskDetails goal={goal} controller={controller} polls={polls} turns={[]} showWorkLink={false} conversationAvailable={false} />
  </>;
}

type GoalDraft = { text: string; criterion: string; revision: number };
export function PlanningGoalObjective({ goal, controller, draft, onChange, showCriterion, conversationAvailable = true }: { goal: CoordinatorGoal; controller: GoalController; draft: GoalDraft | null; onChange: (draft: GoalDraft | null) => void; showCriterion: boolean; conversationAvailable?: boolean }) {
  const objective = draft?.text ?? goal.goal;
  const criterion = draft?.criterion ?? goal.completionCriterion;
  const change = (patch: Partial<GoalDraft>) => onChange({ text: objective, criterion, revision: draft?.revision ?? goal.revision, ...patch });
  const editable = goal.ownedByMe && !["completed", "cancelled", "failed"].includes(goal.lifecycle);
  return <section className="recipe-section"><form onSubmit={event => { event.preventDefault(); void controller.operate({ op: "edit_goal", goalId: goal.goalId, expectedRevision: draft?.revision ?? goal.revision, goal: objective, completionCriterion: criterion }).then(saved => { if (saved) onChange(null); }); }}>
    <label className="fieldnotes-field"><span>Goal</span><textarea value={objective} maxLength={1000} required disabled={!editable || controller.pending} onChange={event => change({ text: event.target.value })} /></label>
    {showCriterion ? <details className="recipe-secondary-actions"><summary>What does done look like?</summary><label className="fieldnotes-field"><span>Finish line</span><textarea value={criterion} maxLength={400} disabled={!editable || controller.pending} onChange={event => change({ criterion: event.target.value })} /></label></details> : null}
    {editable && (objective !== goal.goal || criterion !== goal.completionCriterion) ? <button className="cm-action" disabled={controller.pending || !objective.trim() || !criterion.trim()}>Save goal</button> : null}
  </form>{conversationAvailable ? <Link className="cm-action cm-action--link" href={`/c/${controller.slug}/coordinator?thread=${goal.threadId}`}>Build with Coordinator</Link> : null}</section>;
}
