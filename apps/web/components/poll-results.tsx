import { optionResponseLabels, optionResponseValues, type PublicPoll } from "@commons/contracts";

export function PollResults({ poll }: { poll: Pick<PublicPoll, "questions" | "aggregates" | "responseCount" | "resultsVisible" | "identityBound"> }) {
  if (poll.questions.length && poll.questions.every(q => q.organizerOnly || (q.kind === "text" && q.foodField))) return null;
  if (!poll.resultsVisible) {
    return <div className="poll-results poll-results--hidden"><strong>Results appear when voting closes.</strong></div>;
  }
  return <div className="poll-results">
    <div className="poll-results__summary"><strong>{poll.responseCount}</strong><span>{poll.responseCount === 1 ? "response" : "responses"}</span></div>
    <p>Answers aren’t a group decision or an RSVP.{!poll.identityBound ? " Names haven’t been verified." : ""}</p>
    {poll.questions.length > 1 ? <p>Top choices may come from different people.</p> : null}
    {poll.questions.map((question) => {
      const aggregate = poll.aggregates.find((item) => item.questionId === question.id);
      if (question.kind === "text") return <section className="poll-result-question" key={question.id}><h2>{question.prompt}</h2><p>{aggregate?.textResponseCount ?? 0} written responses</p></section>;
      if (question.kind !== "choice") return <section className="poll-result-question" key={question.id}><h2>{question.prompt}</h2>
        <p>{aggregate?.answeredCount ?? 0} answered{question.kind !== "option_response" ? ` · ${aggregate?.abstainedCount ?? 0} abstained` : ""}. {question.kind === "option_response" && question.scale === "yes_maybe_no" ? "Maybe and abstaining don’t make it feasible." : "Preferences aren’t availability."}</p>
        <div className="poll-result-options">{question.options.map(option => <div className="poll-result-option" key={option.id}><strong>{option.label}</strong>
          <p>{question.kind === "option_response" ? optionResponseValues(question.scale).map(value => `${optionResponseLabels[value]}: ${aggregate?.optionResponseCounts?.[option.id]?.[value] ?? 0}`).join(" · ")
            : question.kind === "ranking" ? (aggregate?.rankCounts?.[option.id] ?? question.options.map(() => 0)).map((count, rank) => `Rank ${rank + 1}: ${count}`).join(" · ")
              : `${aggregate?.pointTotals?.[option.id] ?? 0} points from ${aggregate?.answeredCount ?? 0} allocations`}</p>
        </div>)}</div>
      </section>;
      const maximum = Math.max(1, ...question.options.map((option) => aggregate?.optionCounts[option.id] ?? 0));
      return <section className="poll-result-question" key={question.id}><h2>{question.prompt}</h2><div className="poll-result-options">{question.options.map((option) => {
        const count = aggregate?.optionCounts[option.id] ?? 0;
        return <div className="poll-result-option" key={option.id}><div><strong>{option.label}</strong><span>{question.availability ? `${count} of ${poll.responseCount}${option.schedule ? " available" : " responses"}` : count}</span></div><i aria-hidden="true"><span style={{ width: `${(count / maximum) * 100}%` }} /></i></div>;
      })}</div></section>;
    })}
  </div>;
}
