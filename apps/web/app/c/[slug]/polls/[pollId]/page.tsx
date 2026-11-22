import { PollWorkspaceHeader } from "@/components/poll-workspace-header";
import Link from "next/link";
import { formatPollAnswer } from "@commons/contracts";
import { notFound, redirect } from "next/navigation";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons";
import { loadAuthenticatedEventAttendance, loadAuthenticatedPoll, loadAuthenticatedPollDrafts } from "@/lib/server/polls";
import { PollCommunication } from "@/components/poll-communication";
import { PollAudienceReview } from "@/components/poll-audience-review";
import { PollDeliveryReview } from "@/components/poll-delivery-review";
import { PollDecisionReview } from "@/components/poll-decision-review";
import { PollResults } from "@/components/poll-results";
import { PollDetailControls } from "./poll-detail-controls";
import { PollResponseDelete } from "./poll-response-delete";
import { commonsSiteOrigin } from "@/lib/server/runtime-environment";
import { emailDeliveryAvailable } from "@/lib/email/resend";
import { publicPollPath } from "@/lib/poll-route";
import { PollCombinationReview } from "@/components/poll-combination-review";
import { itineraryQuestion } from "@/lib/itinerary-workshop";
import { ItineraryDocument } from "@/components/itinerary-document";
import { ItineraryFeedbackResults } from "@/components/itinerary-feedback-results";

export const dynamic = "force-dynamic";
export const metadata = { title: "Poll — Commons" };

export default async function PollDetailPage({ params }: { params: Promise<{ slug: string; pollId: string }> }) {
  const { slug, pollId } = await params;
  let poll: Awaited<ReturnType<typeof loadAuthenticatedPoll>>;
  try {
    poll = await loadAuthenticatedPoll(slug, pollId);
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/polls/${pollId}`)}`);
    if (error instanceof CommonsMembershipRequiredError) notFound();
    notFound();
  }
  const origin = commonsSiteOrigin();
  // A copy with no email set up can't send poll links, so it doesn't offer to.
  const emailLinks = emailDeliveryAvailable();
  const shareUrl = `${origin}${publicPollPath(poll.publicId)}`;
  const itinerary = itineraryQuestion(poll.questions);
  if (itinerary) return <main className="poll-organizer-shell"><PollWorkspaceHeader eventName={poll.event.name} eventHref={`/c/${slug}`} eventLabel="Trip Home" pollsHref={`/c/${slug}/polls`}/><div className="poll-organizer-content poll-detail-content"><h1>{poll.title}</h1>{poll.currentActorRole === "organizer" ? <><ItineraryFeedbackResults slug={slug} pollId={poll.id} initialPoll={poll}/></> : <p>The organizer is reviewing feedback. <Link href={publicPollPath(poll.publicId)}>View your itinerary and response</Link></p>}<ItineraryDocument itinerary={itinerary.itinerary}/></div></main>;
  const nextDraft = poll.currentActorRole === "organizer" ? (await loadAuthenticatedPollDrafts(slug)).find(draft => draft.data.sourcePollId === pollId && draft.data.communication && !draft.publishedPollId) : undefined;
  const audiencePeople = poll.audienceReview ? (await loadAuthenticatedEventAttendance(slug)).people.map(person => ({ id: person.personId, name: person.displayName })) : [];
  return <main className="poll-organizer-shell">
    <PollWorkspaceHeader eventName={poll.event.name} eventHref={`/c/${slug}`} eventLabel="Trip Home" pollsHref={`/c/${slug}/polls`} />
    <div className="poll-organizer-content poll-detail-content">
      <div className="poll-organizer-intro poll-page-heading"><div><span className="view-kicker">{poll.status === "open" ? "Voting open" : "Poll closed"}</span><h1>{poll.title}</h1></div><a className="cm-action" href="#poll-sharing">Share</a></div>
      {poll.intro ? <p>{poll.intro}</p> : null}
      {nextDraft ? <section className="fieldnotes-context"><span className="view-kicker">Your next step is ready</span><h2>Review the next poll</h2><p>The message and options are drafted. Review them and approve when ready.</p><Link className="cm-action cm-action--primary" href={`/c/${slug}/reviews/${nextDraft.id}`}>Review the next poll</Link></section> : null}
      {poll.superseded ? <p role="status">This poll was replaced. Its responses are kept but don’t count toward the new one. {poll.superseded.replacementPublicId ? <a href={`/c/poll/${poll.superseded.replacementPublicId}`}>Open the new poll</a> : "The new poll is still a draft."}</p> : null}
      {poll.communication ? <><PollCommunication message={poll.communication} /><p role="status">{emailLinks ? "Published. Nothing was emailed. Check delivery status below." : "Published. Nothing was emailed. Share the link below."}</p></> : null}
      <PollResults poll={poll} />
      {poll.currentActorCanManage && !poll.decision ? <PollDetailControls mode="status" pollId={poll.id} slug={slug} shareUrl={shareUrl} status={poll.status} canManage /> : null}
      <PollDecisionReview slug={slug} poll={poll} />
      {poll.ballotMode === "transparent" && poll.questions.filter(question => question.kind === "choice").length > 1 && poll.responses.length ? <details className="fieldnotes-context poll-comparison"><summary>Compare choices across questions</summary><PollCombinationReview questions={poll.questions} responses={poll.responses.map(response => ({ ...response, answers: response.answers?.map(answer => ({ questionId: answer.questionId, optionIds: answer.optionIds, text: answer.text })) ?? null }))} /></details> : null}
      {poll.ballotMode === "transparent" && poll.responses.length ? <section className="poll-responses"><h2>Responses</h2>{poll.responses.map((response) => <article key={response.id}><strong>{response.respondentName}</strong><div>{response.answers?.map((answer) => {
        const question = poll.questions.find((item) => item.id === answer.questionId);
        if (!question) return null;
        const value = formatPollAnswer(question, answer);
        return <div key={answer.questionId}><p><span>{question.prompt}</span>{value || "No answer"}</p>{answer.context ? <p><span>For organizers only · {answer.context.kind}</span>{answer.context.text}</p> : null}</div>;
      })}{poll.currentActorCanManage ? <PollResponseDelete pollId={poll.id} responseId={response.id} respondentName={response.respondentName} slug={slug} /> : null}</div></article>)}</section> : null}
      {poll.currentActorCanManage ? <div className="poll-action-row"><Link className="cm-action" href={`/c/${slug}/polls/new?followUp=${poll.id}`}>Start a follow-up poll</Link></div> : null}
      <section id="poll-sharing" className="poll-responses"><h2>Share</h2>
        <p>{poll.identityBound ? "This link is only for people with access to the poll." : "Anyone with this link can respond."} Copying the link doesn’t email anyone.</p>
        <PollDetailControls pollId={poll.id} slug={slug} shareUrl={shareUrl} status={poll.status} canManage={poll.currentActorCanManage} />
        {emailLinks && poll.audienceReview && poll.currentActorCanManage && poll.status === "open" ? <details className="fieldnotes-context" open={Boolean(poll.communication)}><summary>{poll.communication ? "Message and poll delivery" : "Email poll links"}</summary><PollDeliveryReview slug={slug} pollId={poll.id} people={audiencePeople} includesMessage={Boolean(poll.communication)} /></details> : null}
        {poll.audienceReview && poll.currentActorCanManage ? <details className="fieldnotes-context"><summary>Manage access</summary><PollAudienceReview slug={slug} pollId={poll.id} audience={poll.audienceReview} people={audiencePeople} /></details> : null}
      </section>
    </div>
  </main>;
}
