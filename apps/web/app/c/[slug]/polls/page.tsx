import { PollIndex } from "@/components/poll-index";
import { notFound, redirect } from "next/navigation";
import { PollWorkspaceHeader } from "@/components/poll-workspace-header";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError, getCommonsDataMode, loadCommonsSnapshot } from "@/lib/server/commons";
import { loadAuthenticatedPollDrafts } from "@/lib/server/polls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Polls — Commons" };

export default async function PollsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (getCommonsDataMode() !== "database") notFound();
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
  return <main className="poll-organizer-shell">
    <PollWorkspaceHeader eventName={snapshot.commons.name} eventHref={`/c/${slug}`} eventLabel="Trip Home" />
    <PollIndex slug={slug} drafts={drafts} polls={polls} />
  </main>;
}
