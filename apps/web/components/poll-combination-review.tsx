"use client";

import { useState } from "react";
import type { PollAnswer, PollQuestion } from "@commons/contracts";
import { matchingPollResponses } from "@/lib/poll-combination";

export function PollCombinationReview({ questions, responses }: { questions: PollQuestion[]; responses: { id: string; respondentName: string; answers: PollAnswer[] | null }[] }) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const choices = questions.filter(question => question.kind === "choice");
  if (choices.length < 2 || !responses.length) return null;
  const count = Object.values(selections).filter(Boolean).length;
  const matches = matchingPollResponses(responses, selections);
  return <section className="poll-results" aria-label="Compare a combination"><h2>Do these choices work together?</h2>
    {choices.map(question => <label className="fieldnotes-field" key={question.id}><span>{question.prompt}</span><select value={selections[question.id] ?? ""} onChange={event => setSelections(current => ({ ...current, [question.id]: event.target.value }))}><option value="">Leave out of comparison</option>{question.options.filter(option => !option.exclusive).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>)}
    <div role="status">{count < 2 ? <p>Choose options from at least two questions.</p> : <><strong>{matches.length} of {responses.length} responses chose all these options.</strong>{matches.length ? <p>{matches.map(response => response.respondentName).join(", ")}</p> : null}<p>Matching answers aren’t agreement. Check conditions and needs first. People who haven’t answered aren’t counted.</p></>}</div>
  </section>;
}
