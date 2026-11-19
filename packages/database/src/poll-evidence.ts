import { asc, eq } from "drizzle-orm";
import type { CommandTransaction } from "./event-command";
import { commandFingerprint } from "./event-command";
import { commons, memberships, pollResponses, polls } from "./schema";

export async function readPollEvidence(tx: Pick<CommandTransaction, "select">, poll: typeof polls.$inferSelect) {
  const [event] = await tx.select({ startsOn: commons.startsOn, endsOn: commons.endsOn }).from(commons).where(eq(commons.id, poll.commonsId));
  const responses = await tx.select({ id: pollResponses.id, answers: pollResponses.answers, updatedAt: pollResponses.updatedAt, respondentName: pollResponses.respondentName }).from(pollResponses)
    .where(eq(pollResponses.pollId, poll.id)).orderBy(asc(pollResponses.id));
  const memberStates = await tx.select({ personId: memberships.personId, status: memberships.status, attendance: memberships.attendanceState, reviewedDates: memberships.attendanceDates }).from(memberships)
    .where(eq(memberships.commonsId, poll.commonsId)).orderBy(asc(memberships.personId));
  const evidence = { event, questions: poll.questions, audience: poll.audience, ballotMode: poll.ballotMode,
    status: poll.status, memberStates, responses: responses.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })) };
  return { evidence, fingerprint: commandFingerprint("", "poll_evidence", evidence) };
}
