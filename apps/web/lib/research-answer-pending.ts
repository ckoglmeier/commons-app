import { z } from "zod";
import type { ResearchWorkspaceAnswerCommand, ResearchWorkspaceHistory } from "./server/research-workspace-service";
import { sameTransportAnswers } from "./research-transport-answers";

const count = (max: number) => z.number().int().min(0).max(max).nullable();
export const transportAnswerDraftSchema = z.object({
  drivers: z.object({ arrival: count(20), wineries: count(20), return: count(20) }).strict(),
  luggagePieces: count(200),
}).strict();
const pendingSchema = z.object({ version: z.literal(1), body: z.object({
  commandId: z.string().uuid(), goalId: z.string().uuid(), expectedRevision: z.number().int().positive(),
  expectedReviewCommandId: z.string().uuid(), expectedSourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  answers: transportAnswerDraftSchema,
}).strict() }).strict();
export type ResearchAnswerPending = { version: 1; body: ResearchWorkspaceAnswerCommand };
export const researchAnswerKey = (trip: string, actor: string, goal: string) => `commons:${trip}:${actor}:${goal}:research-answer`;
export function readResearchAnswerPending(raw: string | null): ResearchAnswerPending | null {
  if (raw === null) return null;
  if (raw.length > 4000) throw new Error("Saved answer request is unreadable.");
  return pendingSchema.parse(JSON.parse(raw));
}
/** A current goal alone is not proof that this particular request landed. */
export function matchesResearchAnswerReceipt(record: ResearchAnswerPending, history: ResearchWorkspaceHistory | null) {
  return Boolean(history && history.goalId === record.body.goalId && history.reviewCommandId === record.body.commandId
    && history.transportAnswers && sameTransportAnswers(history.transportAnswers, record.body.answers));
}
