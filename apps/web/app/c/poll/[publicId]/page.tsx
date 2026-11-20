import { PollWorkspaceHeader } from "@/components/poll-workspace-header";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { PollResponseForm } from "@/app/poll/[token]/poll-response-form";
import { ItineraryTravelerWorkspace } from "@/components/itinerary-traveler-workspace";
import { itineraryQuestion } from "@/lib/itinerary-workshop";
import { normalizePollPublicId, publicPollPath } from "@/lib/poll-route";
import { authenticatedPollViewer, loadPublicPollByPublicId, pendingPollInvitation, pollEventNavigation } from "@/lib/server/polls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Poll — Commons" };

export default async function PublicPollPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const canonicalId = normalizePollPublicId(publicId);
  if (!canonicalId) notFound();
  if (publicId !== canonicalId) redirect(publicPollPath(canonicalId));
  const poll = await loadPublicPollByPublicId(canonicalId);
  if (!poll) {
    const viewer = await authenticatedPollViewer();
    if (!viewer) redirect(`/sign-in?next=${encodeURIComponent(publicPollPath(canonicalId))}&intent=invited`);
    const invitationToken = await pendingPollInvitation(canonicalId);
    if (invitationToken) redirect(`/join/${invitationToken}?poll=${canonicalId}`);
    return <main className="public-poll-shell cm-document-canvas"><div className="cm-document-page">
      <section className="public-poll-card public-poll-body cm-document-paper">
        <span className="view-kicker">Poll invitation</span>
        <h1>This poll is for invited travelers.</h1>
        <p className="public-poll-lede">You’re signed in with an account that isn’t on this invitation. Use the email the organizer invited, or ask them to send you a new invitation.</p>
        <form action={`/auth/sign-out?next=${encodeURIComponent(publicPollPath(canonicalId))}&intent=invited`} method="post" className="poll-action-row poll-editor-actions">
          <button className="cm-action cm-action--primary" type="submit">Use a different email</button>
        </form>
      </section>
    </div></main>;
  }
  const navigation = await pollEventNavigation(poll.event.slug, poll.id);
  if (itineraryQuestion(poll.questions)) return <main><PollWorkspaceHeader eventName={poll.event.name} {...navigation} /><ItineraryTravelerWorkspace initialPoll={poll} /></main>;
  return <main className="public-poll-shell cm-document-canvas">
    <PollWorkspaceHeader eventName={poll.event.name} {...navigation} />
    <div className="cm-document-page">
      <section className="public-poll-card cm-document-paper">
        {poll.event.coverImageUrl ? <header className="public-poll-header">
          <div className="public-poll-cover"><Image src={poll.event.coverImageUrl} alt="" fill sizes="80px" unoptimized /></div>
          <em>{poll.questions.length} {poll.questions.length === 1 ? "question" : "questions"}</em>
        </header> : null}
        <PollResponseForm token={poll.publicId} initialPoll={poll} offerOwnTrip />
      </section>
    </div>
  </main>;
}
