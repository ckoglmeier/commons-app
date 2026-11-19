"use client";

import { optionResponseLabels, optionResponseValues, type PollAnswer, type PollQuestion } from "@commons/contracts";

type TypedQuestion = Extract<PollQuestion, { kind: "option_response" | "ranking" | "allocation" }>;
export function PollTypedAnswer({ question, answer, onChange }: { question: TypedQuestion; answer?: PollAnswer; onChange: (answer: PollAnswer) => void }) {
  const base = { questionId: question.id, optionIds: [], text: null };
  const reset = () => onChange(base);
  const total = answer?.allocations?.reduce((sum, row) => sum + row.points, 0) ?? 0;
  return <fieldset className="poll-question poll-typed-answer">
    <legend>{question.prompt}</legend>
    <p>{question.kind === "option_response" ? question.scale === "interest" ? "Rate your interest in each place. Interest isn’t availability." : "Answer for every option. Maybe means it depends. No means you can’t." : question.kind === "ranking" ? "Rank every option, first to last. No ties. Or abstain." : "Split exactly 10 points across the options, in whole numbers. 0 isn’t a veto. Or abstain."} {!question.required ? "Optional." : ""}</p>
    {question.kind !== "option_response" ? <label className="poll-option"><input type="checkbox" checked={Boolean(answer?.abstained)} onChange={event => onChange(event.target.checked ? { ...base, abstained: true } : base)} /><span>Abstain. I have no preference.</span></label> : null}
    {!answer?.abstained ? question.options.map(option => <label className="fieldnotes-field poll-typed-answer__row" key={option.id}>
      <span>{option.label}</span>
      {question.kind === "option_response" ? <select aria-label={`${option.label}: response`} value={answer?.optionResponses?.find(row => row.optionId === option.id)?.value ?? ""} onChange={event => {
        const rows = (answer?.optionResponses ?? []).filter(row => row.optionId !== option.id);
        if (event.target.value) rows.push({ optionId: option.id, value: event.target.value as NonNullable<PollAnswer["optionResponses"]>[number]["value"] });
        onChange({ ...base, optionResponses: question.options.flatMap(item => rows.filter(row => row.optionId === item.id)) });
      }}><option value="">Choose a response</option>{optionResponseValues(question.scale).map(value => <option key={value} value={value}>{optionResponseLabels[value]}</option>)}</select>
        : question.kind === "ranking" ? <select aria-label={`${option.label}: rank`} value={answer?.rankedOptionIds?.includes(option.id) ? String(answer.rankedOptionIds.indexOf(option.id) + 1) : ""} onChange={event => {
          const ranked = Array.from({ length: question.options.length }, (_, index) => answer?.rankedOptionIds?.[index] === option.id ? "" : answer?.rankedOptionIds?.[index] ?? "");
          if (event.target.value) ranked[Number(event.target.value) - 1] = option.id;
          onChange({ ...base, ...(ranked.some(Boolean) ? { rankedOptionIds: ranked } : {}) });
        }}><option value="">Choose rank</option>{question.options.map((_, index) => <option key={index} value={index + 1}>{index + 1}{index === 0 ? " · first choice" : index === question.options.length - 1 ? " · last choice" : ""}</option>)}</select>
          : <input type="number" aria-label={`${option.label}: points`} min={0} max={10} step={1} inputMode="numeric" value={answer?.allocations?.find(row => row.optionId === option.id)?.points ?? ""} onChange={event => {
            const rows = (answer?.allocations ?? []).filter(row => row.optionId !== option.id);
            if (event.target.value !== "") rows.push({ optionId: option.id, points: Number(event.target.value) });
            onChange({ ...base, allocations: question.options.flatMap(item => rows.filter(row => row.optionId === item.id)) });
          }} />}
    </label>) : null}
    {question.kind === "allocation" && !answer?.abstained ? <p role="status">{total} of 10 points allocated{total === 10 ? " · Enter a number for every option, including zero." : ` · ${total < 10 ? `${10 - total} remaining` : `${total - 10} too many`}`}</p> : null}
    <button type="button" className="cm-action" onClick={reset}>Clear this answer</button>
  </fieldset>;
}
