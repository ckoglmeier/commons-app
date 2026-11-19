import type { CoordinatorGoal } from "@commons/contracts";

/** Preserve readable history, but never present a superseded result as current
 * evidence. Shared by the main/task prompt and compatibility status adapter. */
export function goalEvidenceProjection(goal: Pick<CoordinatorGoal, "outcome" | "outcomeRevision" | "revision" | "resultStale">) {
  const resultOutdated = goal.resultStale || Boolean(goal.outcomeRevision && goal.outcomeRevision !== goal.revision);
  return { resultOutdated, outcomeRevision: goal.outcomeRevision,
    outcome: resultOutdated ? null : goal.outcome,
    historicalOutcome: resultOutdated ? goal.outcome : null };
}
