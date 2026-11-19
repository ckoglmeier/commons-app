import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PollWorkspaceHeader } from "@/components/poll-workspace-header";
import { CommonsAuthenticationRequiredError, loadCommonsSnapshot } from "@/lib/server/commons";
import { authenticatedGoals } from "@/lib/server/coordinator-goal-service";
import { coordinatorGoalsAvailableFor } from "@/lib/server/goal-access";
import { goalLabel } from "@/lib/coordinator-goal-presentation";
import { heldFeaturePath, tripCapabilitiesFor } from "@/lib/server/trip-capabilities";

export const dynamic = "force-dynamic";
export const metadata = { title: "Questions and decisions" };
export default async function GoalsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const capabilities = await tripCapabilitiesFor(slug);
  if (!capabilities.goals) redirect(heldFeaturePath(slug));
  if (!await coordinatorGoalsAvailableFor(slug)) notFound();
  let state, snapshot;
  try { [state, snapshot] = await Promise.all([authenticatedGoals(slug), loadCommonsSnapshot(slug)]); }
  catch (error) { if (error instanceof CommonsAuthenticationRequiredError) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/goals`)}`); notFound(); }
  if (!snapshot) notFound();
  return <main className="poll-organizer-shell">
    <PollWorkspaceHeader eventName={snapshot.commons.name} eventHref={`/c/${snapshot.commons.id}`} eventLabel="Trip Home" askHref={`/c/${snapshot.commons.id}/ask`} askLabel="Ask the group" pollsHref={`/c/${snapshot.commons.id}/polls`} {...(capabilities.tier === "beta" ? { goalsHref: `/c/${snapshot.commons.id}/goals`, goalsCurrent: true } : {})} />
    <div className="poll-organizer-content recipe-content">
      <header className="poll-organizer-intro"><h1>Questions and decisions</h1><p>See what the group has answered and what still needs a decision.</p></header>
      <div className="workspace-actions"><Link className="cm-action" href={`/c/${snapshot.commons.id}/ask`}>Start with a group question</Link></div>
      <ul className="recipe-run-list">{state.goals.map(goal => <li key={goal.goalId}>
        <Link href={`/c/${snapshot.commons.id}/goals/${goal.goalId}`}><strong>{goal.title}</strong><span>{goal.goal}</span><small>{goalLabel(goal)}</small></Link>
      </li>)}</ul>
      {!state.goals.length ? <p>No questions started yet.</p> : null}
    </div>
  </main>;
}
