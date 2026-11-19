import { notFound, redirect } from "next/navigation";
import { PollWorkspaceHeader } from "@/components/poll-workspace-header";
import { RecipeStart } from "@/components/recipe-start";
import { CommonsAuthenticationRequiredError, getCommonsDataMode, loadCommonsSnapshot } from "@/lib/server/commons";
import { loadAuthenticatedPollDrafts } from "@/lib/server/polls";
import { RecipesDisabledError, loadAuthenticatedRecipeRuns } from "@/lib/server/recipes";
import { askPath } from "@/lib/ask-route";
import { heldFeaturePath, tripCapabilitiesFor } from "@/lib/server/trip-capabilities";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask the group" };

type Search = Record<string, string | string[] | undefined>;

export default async function AskPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params, search = await searchParams;
  const capabilities = await tripCapabilitiesFor(slug);
  if (!capabilities.goals) redirect(heldFeaturePath(slug));
  if (getCommonsDataMode(slug) !== "database") notFound();
  let runs: Awaited<ReturnType<typeof loadAuthenticatedRecipeRuns>>, drafts: Awaited<ReturnType<typeof loadAuthenticatedPollDrafts>>, snapshot: NonNullable<Awaited<ReturnType<typeof loadCommonsSnapshot>>>;
  try {
    const [loadedRuns, loadedDrafts, loadedSnapshot] = await Promise.all([loadAuthenticatedRecipeRuns(slug), loadAuthenticatedPollDrafts(slug), loadCommonsSnapshot(slug)]);
    if (!loadedSnapshot) notFound();
    runs = loadedRuns; drafts = loadedDrafts; snapshot = loadedSnapshot;
  }
  catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) redirect(`/sign-in?next=${encodeURIComponent(askPath(slug, search))}`);
    if (error instanceof RecipesDisabledError) notFound();
    notFound(); // Not an organizer of this trip, or no such trip: the same answer for both.
  }
  const initial = typeof search.new === "string" ? search.new : null;
  const view = typeof search.view === "string" ? search.view : "new";
  return <main className="poll-organizer-shell"><PollWorkspaceHeader eventName={snapshot.commons.name} eventHref={`/c/${slug}`} pollsHref={`/c/${slug}/polls`} askHref={`/c/${slug}/ask`} eventLabel="Trip Home" askLabel="Ask the group" askCurrent {...(capabilities.tier === "beta" ? { goalsHref: `/c/${slug}/goals` } : {})} />
    <div className="poll-organizer-content recipe-content"><RecipeStart key={initial ?? view} slug={slug} runs={runs} pollDrafts={drafts} polls={snapshot.state.pollRequests ?? []} initial={initial} view={view} /></div></main>;
}
