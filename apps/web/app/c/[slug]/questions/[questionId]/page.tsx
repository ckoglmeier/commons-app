import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { PollWorkspaceHeader } from "@/components/poll-workspace-header";
import { ParticipantQuestionAnswer } from "@/components/participant-question-answer";
import { CommonsAuthenticationRequiredError } from "@/lib/server/commons";
import { authenticatedMyParticipantQuestion } from "@/lib/server/participant-questions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "A question for you", robots: { index: false } };

export default async function ParticipantQuestionPage({ params }: { params: Promise<{ slug: string; questionId: string }> }) {
  const { slug, questionId } = await params;
  let question: Awaited<ReturnType<typeof authenticatedMyParticipantQuestion>>;
  try {
    question = await authenticatedMyParticipantQuestion(slug, questionId);
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/questions/${questionId}`)}`);
    // Every other failure reads the same, so a guessed or forwarded link reveals nothing about whether the question exists.
    return <main className="public-poll-shell cm-document-canvas"><div className="cm-document-page">
      <section className="public-poll-card public-poll-body cm-document-paper">
        <h1>This question isn’t available.</h1>
        <p className="public-poll-lede">It may have been withdrawn, or it may be addressed to someone else.</p>
        <div className="poll-action-row"><Link className="cm-action cm-action--primary" href={`/c/${slug}`}>Back to the trip</Link></div>
      </section>
    </div></main>;
  }
  return <main className="public-poll-shell cm-document-canvas">
    <PollWorkspaceHeader eventName={question.tripName} eventHref={`/c/${slug}`} eventLabel="Trip Home" />
    <div className="cm-document-page"><section className="public-poll-card public-poll-body cm-document-paper">
      <ParticipantQuestionAnswer slug={slug} initial={question} />
    </section></div>
  </main>;
}
