/*
 * Closing a poll, or hearing from everyone, does not by itself resolve a goal (docs/BETA-REWORK.md BR-03). When a closed round
 * leaves the organizer without an option that works for everyone who answered, or when someone has not answered, the goal page
 * says so plainly and offers the two real next steps: an explicit organizer decision, or a revised round. Pure and derived
 * only from the saved run; it records nothing and decides nothing.
 */
type Row = { worksForAllWhoAnswered?: boolean; acceptedBy?: readonly string[] };
export type GoalDecisionRun = {
  stage: string; outcome?: unknown;
  poll?: { responseCount: number; superseded?: boolean } | null;
  /** Dates and lodging summaries have option rows; other summaries have none and produce no prompt. */
  summary?: object | null;
};
type Summary = { rows?: readonly Row[]; respondedCount?: number; awaiting?: readonly string[] };
export type GoalDecisionPrompt = { kind: "no_fit" | "silence"; heading: string; message: string };

export function goalDecisionPrompt(run: GoalDecisionRun): GoalDecisionPrompt | null {
  if (run.stage !== "decide" || run.outcome || !run.poll || run.poll.superseded || !run.poll.responseCount) return null;
  const summary = run.summary as Summary | null | undefined, rows = summary?.rows;
  if (!summary || !rows?.length) return null;
  const responded = summary.respondedCount ?? run.poll.responseCount;
  if (responded <= 0) return null;
  const works = rows.some(row => row.worksForAllWhoAnswered ?? (row.acceptedBy?.length === responded));
  const awaiting = summary.awaiting ?? [];
  const silent = awaiting.length ? ` ${awaiting.length === 1 ? "One person" : `${awaiting.length} people`} didn’t answer (${awaiting.join(", ")}); silence isn’t counted as agreement.` : "";
  if (!works) return { kind: "no_fit", heading: "These answers don’t settle the goal yet",
    message: `No option works for everyone who answered.${silent} Choose an option yourself and record why under Decide, or start a revised round with changed options. Earlier answers stay as history and don’t carry over to the new round.` };
  if (awaiting.length) return { kind: "silence", heading: "Not everyone has answered",
    message: `At least one option works for everyone who answered.${silent} You can ask again with a revised round, or choose an option yourself under Decide; nothing is decided until you do.` };
  return null;
}
