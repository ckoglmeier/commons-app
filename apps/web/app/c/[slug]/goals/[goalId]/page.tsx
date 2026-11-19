import { notFound, redirect } from "next/navigation";
import { PollWorkspaceHeader } from "@/components/poll-workspace-header";
import { DirectGoal, PlanningGoal } from "@/components/planning-goal";
import { CommonsAuthenticationRequiredError, loadCommonsSnapshot } from "@/lib/server/commons";
import { authenticatedGoals } from "@/lib/server/coordinator-goal-service";
import { loadAuthenticatedGoalWorkflow } from "@/lib/server/goal-workflow-service";
import { tripCapabilitiesFor } from "@/lib/server/trip-capabilities";

export const dynamic = "force-dynamic";
export const metadata = { title: "Goal" };

export default async function GoalPage({ params }: { params: Promise<{ slug: string; goalId: string }> }) {
  const { slug, goalId } = await params;
  let state, snapshot;
  try { [state, snapshot] = await Promise.all([authenticatedGoals(slug), loadCommonsSnapshot(slug)]); }
  catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/goals/${goalId}`)}`);
    notFound();
  }
  const goal = state.goals.find(item => item.goalId === goalId);
  if (!goal || !snapshot) notFound();
  const capabilities = await tripCapabilitiesFor(slug);
  const goalsHref = capabilities.tier === "beta" ? `/c/${snapshot.commons.id}/goals` : undefined;
  const runId = goal.steps.find(step => step.kind === "planning")?.refId;
  if (!runId && capabilities.coordinator) redirect(`/c/${snapshot.commons.id}/coordinator?thread=${goal.threadId}`);
  // No Coordinator: a goal without a planning workflow keeps its own controls here instead of redirecting to a conversation.
  if (!runId) return <main className="poll-organizer-shell"><PollWorkspaceHeader eventName={snapshot.commons.name} eventHref={`/c/${snapshot.commons.id}`} eventLabel="Trip Home" askHref={`/c/${snapshot.commons.id}/ask`} askLabel="Ask the group" pollsHref={`/c/${snapshot.commons.id}/polls`} goalsHref={goalsHref} goalsCurrent /><div className="poll-organizer-content recipe-content"><DirectGoal slug={snapshot.commons.id} actorId={snapshot.currentActor.id} initialGoal={goal} polls={(snapshot.state.pollRequests ?? []).map(poll => ({ id: poll.id, title: poll.title }))} /></div></main>;
  let run;
  try { run = await loadAuthenticatedGoalWorkflow(slug, runId); } catch { notFound(); }
  return <main className="poll-organizer-shell"><PollWorkspaceHeader eventName={snapshot.commons.name} eventHref={`/c/${snapshot.commons.id}`} eventLabel="Trip Home" askHref={`/c/${snapshot.commons.id}/ask`} askLabel="Ask the group" pollsHref={`/c/${snapshot.commons.id}/polls`} goalsHref={goalsHref} goalsCurrent /><div className="poll-organizer-content recipe-content"><PlanningGoal slug={snapshot.commons.id} actorId={snapshot.currentActor.id} initialGoal={goal} initialRun={run} conversationAvailable={capabilities.coordinator} /></div></main>;
}
