import { PollAnswerSchema, pollBallotError, formatPollAnswer, type PollAnswer, type PollQuestion } from "@commons/contracts";
import { z } from "zod";

export const SavedPollResponseSchema = z.object({
  receiptToken: z.string().min(24).max(200),
  respondentName: z.string().min(1).max(80),
  answers: z.array(PollAnswerSchema).max(8),
  updatedAt:z.string().datetime().optional(),
});

export function pollResponseError(questions: PollQuestion[], answers: PollAnswer[]): string | null {
  return pollBallotError(questions, answers);
}

export function pollAnswerLabel(question: PollQuestion, answer?: PollAnswer): string {
  return formatPollAnswer(question, answer);
}
