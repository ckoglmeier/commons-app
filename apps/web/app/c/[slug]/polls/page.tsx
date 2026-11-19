import { PollIndex } from "@/components/poll-index";
import { notFound, redirect } from "next/navigation";
import { PollWorkspaceHeader } from "@/components/poll-workspace-header";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError, getCommonsDataMode, loadCommonsSnapshot } from "@/lib/server/commons";
import { loadAuthenticatedPollDrafts } from "@/lib/server/polls";
import { recipesAvailableFor } from "@/lib/server/recipe-access";
import { askNavigationHref } from "@/lib/ask-route";
import { tripCapabilitiesFor } from "@/lib/server/trip-capabilities";

export const dynamic = "force-dynamic";

export default async function PollsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (getCommonsDataMode(slug) !== "database") notFound();
  let snapshot;
  try { snapshot = await loadCommonsSnapshot(slug); }
  catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/polls`)}`);
    if (error instanceof CommonsMembershipRequiredError) notFound();
    throw error;
  }
  if (!snapshot) notFound();
  const drafts = (await loadAuthenticatedPollDrafts(slug)).filter(draft => !draft.publishedPollId);
  const polls = snapshot.state.pollRequests ?? [];
  const capabilities = await tripCapabilitiesFor(slug);
  const askHref = askNavigationHref(slug, snapshot.currentActor.role, snapshot.currentActor.role === "organizer" && await recipesAvailableFor(slug));
  return <main className="poll-organizer-shell">
    <PollWorkspaceHeader eventName={snapshot.commons.name} eventHref={`/c/${slug}`} eventLabel="Trip Home" askHref={askHref} goalsHref={snapshot.currentActor.role === "organizer" && capabilities.tier === "beta" ? `/c/${slug}/goals` : undefined}>
      {snapshot.currentActor.role === "organizer" && capabilities.coordinator ? <a className="cm-action" href={`/c/${slug}/coordinator`}>Talk with Commons</a> : null}
    </PollWorkspaceHeader>
    <PollIndex slug={slug} drafts={drafts} polls={polls} />
  </main>;
}
