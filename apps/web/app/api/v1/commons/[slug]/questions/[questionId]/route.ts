import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/bounded-json";
import { answerAuthenticatedParticipantQuestion, authenticatedMyParticipantQuestion, participantQuestionErrorResponse, participantQuestionHeaders } from "@/lib/server/participant-questions";

type Context = { params: Promise<{ slug: string; questionId: string }> };

/** The one question addressed to the signed-in person. Anyone else gets not-found. */
export async function GET(_request: Request, context: Context) {
  try { const { slug, questionId } = await context.params; return NextResponse.json(await authenticatedMyParticipantQuestion(slug, questionId), { headers: participantQuestionHeaders }); }
  catch (error) { return participantQuestionErrorResponse(error); }
}

/** Submit (or deliberately correct) the answer: `{ submissionId, body, expectedAnswerRevision }`. A retry with the same submission returns its receipt. */
export async function POST(request: Request, context: Context) {
  try { const { slug, questionId } = await context.params; return NextResponse.json(await answerAuthenticatedParticipantQuestion(slug, questionId, await readBoundedJson(request, 4_000)), { headers: participantQuestionHeaders }); }
  catch (error) { return participantQuestionErrorResponse(error); }
}
