import "server-only";
import { ParticipantQuestionCommandSchema } from "@commons/contracts";
import {
  answerParticipantQuestion, cancelParticipantQuestion, listParticipantQuestionRecipients, CommandAccessError, CommandConflictError, listGoalParticipantQuestions, listRecipientParticipantQuestions,
  ParticipantQuestionClosedError, prepareParticipantQuestion, publishParticipantQuestion, readGoalParticipantEvidence, readRecipientParticipantQuestion,
} from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError, isPublicDemoCommonsIdentifier } from "./commons";
import { coordinatorGoalsAvailableFor } from "./goal-access";
import { authenticatedGoalOptions } from "./polls";
import { participantQuestionsEnabled } from "./runtime-environment";

/*
 * Conversation durability lane B, web adapter. Identity always comes from the authenticated session (authenticatedGoalOptions); no route accepts a
 * person id from the client. COMMONS_PARTICIPANT_QUESTIONS_ENABLED (default off) gates creation and the organizer and traveler surfaces. When it is
 * turned off, already published questions keep a clear disposition: their recipient can still read and answer them until they close, and organizers
 * keep the answers in the task. Nothing here sends a message, and nothing here changes travel, Plan or attendance.
 */

export class ParticipantQuestionsUnavailableError extends Error {}

export async function participantQuestionsAvailableFor(slug: string) {
  return participantQuestionsEnabled() && await coordinatorGoalsAvailableFor(slug);
}

export async function operateAuthenticatedParticipantQuestion(slug: string, raw: unknown) {
  if (!await participantQuestionsAvailableFor(slug)) throw new ParticipantQuestionsUnavailableError();
  const command = ParticipantQuestionCommandSchema.parse(raw), options = await authenticatedGoalOptions(slug);
  const { action, ...input } = command;
  if (action === "prepare") return prepareParticipantQuestion(slug, input, options);
  if (action === "publish") return publishParticipantQuestion(slug, input, options);
  return cancelParticipantQuestion(slug, input, options);
}
export async function authenticatedGoalParticipantQuestions(slug: string, goalId: string) {
  return listGoalParticipantQuestions(slug, goalId, await authenticatedGoalOptions(slug));
}
export async function authenticatedParticipantQuestionRecipients(slug: string) {
  return listParticipantQuestionRecipients(slug, await authenticatedGoalOptions(slug));
}
export async function authenticatedGoalParticipantEvidence(slug: string, goalId: string) {
  return readGoalParticipantEvidence(slug, goalId, await authenticatedGoalOptions(slug));
}
/** The signed-in traveler's own questions on this trip, for Home's next steps. Empty when the lane is off and nothing was ever published, and on the sample trip, which anyone can view and which has no database row. */
export async function authenticatedMyParticipantQuestions(slug: string) {
  if (isPublicDemoCommonsIdentifier(slug)) return [];
  try { return await listRecipientParticipantQuestions(slug, await authenticatedGoalOptions(slug)); }
  catch (error) { if (error instanceof CommandAccessError) return []; throw error; }
}
export async function authenticatedMyParticipantQuestion(slug: string, questionId: string) {
  return readRecipientParticipantQuestion(slug, questionId, await authenticatedGoalOptions(slug));
}
export async function answerAuthenticatedParticipantQuestion(slug: string, questionId: string, raw: unknown) {
  return answerParticipantQuestion(slug, questionId, raw, await authenticatedGoalOptions(slug));
}

const headers = { "Cache-Control": "private, no-store" };
/** Stable, content-free errors. Not found covers every access failure so a guessed or forwarded id reveals nothing. */
export function participantQuestionErrorResponse(error: unknown) {
  if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: { code: "auth_required", message: "Sign in to continue." } }, { status: 401, headers });
  if (error instanceof CommonsMembershipRequiredError || error instanceof CommandAccessError) return NextResponse.json({ error: { code: "not_found", message: "This question isn’t available." } }, { status: 404, headers });
  if (error instanceof ParticipantQuestionsUnavailableError) return NextResponse.json({ error: { code: "unavailable", message: "Questions to travelers aren’t available on this trip." } }, { status: 403, headers });
  if (error instanceof ParticipantQuestionClosedError) return NextResponse.json({ error: { code: "closed", message: "This question is closed, so a new answer can’t be saved. Your earlier answer, if any, is unchanged." } }, { status: 409, headers });
  if (error instanceof CommandConflictError) return NextResponse.json({ error: { code: "stale", message: "This changed since you opened it. It’s refreshed; check it and try again." } }, { status: 409, headers });
  if (error instanceof ZodError) return NextResponse.json({ error: { code: "invalid", message: "Check the answer and try again." } }, { status: 400, headers });
  console.warn("commons.participant_question.failed", { reason: error instanceof Error ? error.name : "unknown" });
  return NextResponse.json({ error: { code: "internal", message: "Answer not saved. Try again." } }, { status: 500, headers });
}
export { headers as participantQuestionHeaders };
