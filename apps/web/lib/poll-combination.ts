import type { PollAnswer } from "@commons/contracts";

/** Counts the same ballots across all selected questions, not separate majorities.
 * Optional notes and attendance are deliberately not interpreted here. */
export function matchingPollResponses<T extends { answers: PollAnswer[] | null }>(responses: T[], selections: Record<string, string>): T[] {
  const choices = Object.entries(selections).filter(([, optionId]) => Boolean(optionId));
  if (!choices.length) return [];
  return responses.filter(response => choices.every(([questionId, optionId]) =>
    response.answers?.some(answer => answer.questionId === questionId && answer.optionIds.includes(optionId))));
}
