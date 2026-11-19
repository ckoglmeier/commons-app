import Link from "next/link";
import type { RecipeRunDetail } from "@commons/contracts";

export function RecipeNextStep({ slug, run }: { slug: string; run: RecipeRunDetail }) {
  const awaiting = run.poll?.audienceKind === "invitees" && run.summary && "awaiting" in run.summary ? run.summary.awaiting : null;
  const collecting = ["shared", "collecting"].includes(run.stage);
  const noAnswers = run.stage === "decide" && !run.poll?.responseCount;
  return <section className="recipe-section" aria-label="Next step">
    <h2>{run.stage === "draft" ? "Next: review and share" : noAnswers ? "Voting closed · no answers" : run.stage === "decide" ? "Answers are ready to review" : collecting ? awaiting?.length ? `Waiting on ${awaiting.length} ${awaiting.length === 1 ? "person" : "people"}` : awaiting && run.poll?.responseCount ? "Answers are ready to review" : "Collecting answers" : run.outcome ? "Decision recorded" : "Review this round"}</h2>
    {noAnswers ? <p>No one answered this round. Ask again, or review what you can explicitly confirm.</p> : null}
    {awaiting?.length ? <p>{collecting ? "Still to answer" : "Didn’t answer this round"}: {awaiting.join(", ")}.</p> : null}
    {run.poll?.audienceKind === "link" && collecting ? <p>Anyone with the link can answer. Missing responses can’t be counted.</p> : null}
    {collecting ? <p>Keep collecting, or close voting to review the answers.</p> : null}
    {run.poll && !run.poll.superseded && !["draft", "closed"].includes(run.stage) ? <details className="recipe-secondary-actions"><summary>Ask a different follow-up question</summary><Link className="cm-action" href={`/c/${encodeURIComponent(slug)}/polls/new?followUp=${run.poll.id}`}>Start a separate follow-up poll</Link><p className="recipe-note">The new poll links to this round. Its answers are reviewed separately.</p></details> : null}
    {run.outcome && ["approved", "applied"].includes(run.outcome.status) && !run.outcome.stale.length ? <div className="poll-action-row">
      {run.recipe === "dates_location" || run.recipe === "attendance" ? <Link className="cm-action" href={`/c/${encodeURIComponent(slug)}/ask?new=lodging`}>Compare places to stay</Link> : null}
      {run.recipe === "lodging" || run.recipe === "attendance" ? <Link className="cm-action" href={`/c/${encodeURIComponent(slug)}/recipes/transport`}>Coordinate transport</Link> : null}
    </div> : null}
  </section>;
}
