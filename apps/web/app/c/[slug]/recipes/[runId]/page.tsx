import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PollWorkspaceHeader } from "@/components/poll-workspace-header";
import { RecipeRun } from "@/components/recipe-run";
import { CommonsAuthenticationRequiredError, getCommonsDataMode, loadCommonsSnapshot } from "@/lib/server/commons";
import { RecipesDisabledError, loadAuthenticatedRecipeRun } from "@/lib/server/recipes";
import { authenticatedGoals } from "@/lib/server/coordinator-goal-service";
import { heldFeaturePath, tripCapabilitiesFor } from "@/lib/server/trip-capabilities";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan with the group" };

export default async function RecipeRunPage({ params }: { params: Promise<{ slug: string; runId: string }> }) {
  const { slug, runId } = await params;
  const capabilities = await tripCapabilitiesFor(slug);
  if (!capabilities.goals) redirect(heldFeaturePath(slug));
  if (getCommonsDataMode(slug) !== "database" || !/^[0-9a-f-]{36}$/i.test(runId)) notFound();
  let run: Awaited<ReturnType<typeof loadAuthenticatedRecipeRun>>, name: string;
  try { run = await loadAuthenticatedRecipeRun(slug, runId); name = (await loadCommonsSnapshot(slug))!.commons.name; }
  catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/recipes/${runId}`)}`);
    if (error instanceof RecipesDisabledError) notFound();
    notFound();
  }
  const linked = (await authenticatedGoals(slug)).goals.find(goal => goal.steps.some(step => step.kind === "planning" && step.refId === runId));
  if (linked) redirect(`/c/${slug}/goals/${linked.goalId}`);
  return <main className="poll-organizer-shell"><PollWorkspaceHeader eventName={name} eventHref={`/c/${slug}`} eventLabel="Trip Home" askHref={`/c/${slug}/ask`} askLabel="Ask the group" pollsHref={`/c/${slug}/polls`} {...(capabilities.tier === "beta" ? { goalsHref: `/c/${slug}/goals` } : {})} />
    <div className="poll-organizer-content recipe-content"><nav aria-label="Ask the group navigation" className="recipe-back"><Link href={`/c/${slug}/ask`}>← Ask the group</Link></nav><RecipeRun key={`${run.id}:${run.draft.archived}`} slug={slug} initial={run} /></div></main>;
}
