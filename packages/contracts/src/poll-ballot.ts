import { PollAnswerSchema, type PollAnswer, type PollQuestion } from "./poll";
import { itineraryFeedbackError } from "./itinerary-poll";

export const optionResponseLabels = { yes: "Yes", maybe: "Maybe", no: "No", not_interested: "Not interested", could_go: "Could go", interested: "Interested", top_choice: "Top choice", abstain: "Abstain" } as const;
export const optionResponseValues = (scale: "yes_maybe_no" | "interest") => scale === "interest"
  ? ["not_interested", "could_go", "interested", "top_choice", "abstain"] as const : ["yes", "maybe", "no", "abstain"] as const;

export function pollQuestionFormat(question: PollQuestion) {
  if (question.kind === "text") return "Written answer";
  if (question.kind === "choice") return question.selectionMode === "multiple" ? "Choose all that apply" : "Choose one";
  if (question.kind === "option_response") return question.scale === "interest" ? "Four interest levels per option" : "Yes / Maybe / No per option";
  return question.kind === "ranking" ? "Rank every option; no ties" : "Allocate exactly ten whole points";
}

/** Shared browser/server boundary. Optional omission remains omission; no answer is invented. */
export function validatePollAnswers(questions: PollQuestion[], rawAnswers: PollAnswer[]): PollAnswer[] {
  const known = new Map(questions.map(question => [question.id, question]));
  const answers = new Map<string, PollAnswer>();
  function fail(message: string): never { throw new Error(message); }
  for (const raw of rawAnswers) {
    if (known.get(raw.questionId)?.kind === "ranking" && raw.rankedOptionIds?.some(id => !id)) fail("Rank every option exactly once; partial rankings and ties are not supported.");
    const parsed = PollAnswerSchema.safeParse(raw);
    if (!parsed.success) fail(parsed.error.issues[0]?.message ?? "Check your response.");
    const answer = parsed.data!;
    if (answers.has(answer.questionId)) fail("Answer each question only once.");
    const question = known.get(answer.questionId);
    if (!question) fail("That poll question is no longer available.");
    const feedbackError = itineraryFeedbackError(question.kind === "choice" ? question.itinerary : undefined, answer.itineraryFeedback);
    if (feedbackError) fail(feedbackError);
    const typed = answer.optionResponses !== undefined || answer.rankedOptionIds !== undefined || answer.allocations !== undefined || answer.abstained !== undefined;
    if (question.kind === "text" || question.kind === "choice") {
      if (typed) fail("That answer format does not match this question.");
      if (question.kind === "text") {
        if (answer.optionIds.length) fail("That question needs a written answer.");
        answer.text = answer.text?.trim() || null;
        if (question.required && !answer.text) fail(`Answer “${question.prompt}”.`);
      } else {
        if (answer.text) fail("That question needs an option, not a written answer.");
        answer.text = null;
        answer.optionIds = [...new Set(answer.optionIds)];
        if (answer.optionIds.some(id => !question.options.some(option => option.id === id))) fail("That answer option is no longer available.");
        if (question.required && !answer.optionIds.length) fail(`Answer “${question.prompt}”.`);
        if (question.selectionMode === "single" && answer.optionIds.length > 1) fail(`Choose one answer for “${question.prompt}”.`);
        if (answer.optionIds.length > 1 && question.options.some(option => option.exclusive && answer.optionIds.includes(option.id))) fail(`Choose “${question.prompt}” options or the exclusive answer, not both.`);
      }
    } else {
      if (answer.optionIds.length || answer.text !== null || answer.itineraryFeedback) fail("That answer format does not match this question.");
      const payloads = [answer.optionResponses, answer.rankedOptionIds, answer.allocations].filter(value => value !== undefined);
      if (answer.abstained) {
        if (question.kind === "option_response" || payloads.length) fail("Choose abstention or answer the question, not both.");
      } else {
        const payload = question.kind === "option_response" ? answer.optionResponses : question.kind === "ranking" ? answer.rankedOptionIds : answer.allocations;
        if (payloads.length && (payload === undefined || payloads.length !== 1)) fail("That answer format does not match this question.");
        if (!payload?.length) {
          if (question.required) fail(`Answer “${question.prompt}” or explicitly abstain.`);
        } else {
          const ids = question.kind === "ranking" ? answer.rankedOptionIds! : question.kind === "option_response" ? answer.optionResponses!.map(row => row.optionId) : answer.allocations!.map(row => row.optionId);
          if (new Set(ids).size !== ids.length) fail("Each option must appear exactly once.");
          if (ids.some(id => !question.options.some(option => option.id === id))) fail("That answer option is no longer available.");
          if (ids.length !== question.options.length) fail(question.kind === "ranking" ? "Rank every option exactly once; partial rankings and ties are not supported." : "Answer every option or skip the optional question.");
          if (question.kind === "option_response" && answer.optionResponses!.some(row => !(optionResponseValues(question.scale) as readonly string[]).includes(row.value))) fail("Choose a response from this question’s scale.");
          if (question.kind === "allocation" && answer.allocations!.reduce((sum, row) => sum + row.points, 0) !== question.totalPoints) fail(`Allocate exactly ${question.totalPoints} points, or explicitly abstain.`);
        }
      }
    }
    answers.set(answer.questionId, answer);
  }
  for (const question of questions) if (question.required && !answers.has(question.id)) fail(`Answer “${question.prompt}”.`);
  return questions.flatMap(question => {
    const answer = answers.get(question.id);
    return answer && (answer.optionIds.length || answer.text || answer.context || answer.abstained || answer.optionResponses?.length || answer.rankedOptionIds?.length || answer.allocations?.length || answer.itineraryFeedback?.comments.length || answer.itineraryFeedback?.interests.length || answer.itineraryFeedback?.votes?.length) ? [answer] : [];
  });
}

export function pollBallotError(questions: PollQuestion[], answers: PollAnswer[]) {
  try { validatePollAnswers(questions, answers); return null; } catch (error) { return error instanceof Error ? error.message : "Check your response."; }
}

export function formatPollAnswer(question: PollQuestion, answer?: PollAnswer): string {
  if (!answer) return "Not answered";
  if (answer.abstained) return "Abstained";
  if (question.kind === "text") return answer.text || "Not answered";
  if (question.kind === "choice") return question.options.filter(option => answer.optionIds.includes(option.id)).map(option => option.label).join(", ") || "Not answered";
  const label = (id: string) => question.options.find(option => option.id === id)?.label ?? "Unavailable option";
  if (question.kind === "option_response") return answer.optionResponses?.map(row => `${label(row.optionId)}: ${optionResponseLabels[row.value]}`).join("; ") || "Not answered";
  if (question.kind === "ranking") return answer.rankedOptionIds?.map((id, index) => `${index + 1}. ${label(id)}`).join("; ") || "Not answered";
  return answer.allocations?.map(row => `${label(row.optionId)}: ${row.points} points`).join("; ") || "Not answered";
}

export function aggregatePollAnswers(question: PollQuestion, responses: Array<{ answers: PollAnswer[] }>) {
  const answers = responses.flatMap(response => response.answers.filter(answer => answer.questionId === question.id));
  const base = { questionId: question.id, optionCounts: question.kind === "choice" ? Object.fromEntries(question.options.map(option => [option.id, answers.filter(answer => answer.optionIds.includes(option.id)).length])) : {}, textResponseCount: answers.filter(answer => Boolean(answer.text)).length };
  if (question.kind === "choice" || question.kind === "text") return base;
  const answeredCount = answers.filter(answer => !answer.abstained && Boolean(answer.optionResponses?.length || answer.rankedOptionIds?.length || answer.allocations?.length)).length;
  const abstainedCount = answers.filter(answer => answer.abstained).length;
  if (question.kind === "option_response") return { ...base, answeredCount, abstainedCount, optionResponseCounts: Object.fromEntries(question.options.map(option => [option.id, Object.fromEntries(optionResponseValues(question.scale).map(value => [value, answers.filter(answer => answer.optionResponses?.some(row => row.optionId === option.id && row.value === value)).length]))])) };
  if (question.kind === "ranking") return { ...base, answeredCount, abstainedCount, rankCounts: Object.fromEntries(question.options.map(option => [option.id, question.options.map((_, rank) => answers.filter(answer => answer.rankedOptionIds?.[rank] === option.id).length)])) };
  return { ...base, answeredCount, abstainedCount, pointTotals: Object.fromEntries(question.options.map(option => [option.id, answers.reduce((sum, answer) => sum + (answer.allocations?.find(row => row.optionId === option.id)?.points ?? 0), 0)])) };
}
