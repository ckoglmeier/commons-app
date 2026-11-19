import { NextResponse } from "next/server";
import { authenticatedMyParticipantQuestions, participantQuestionErrorResponse, participantQuestionHeaders } from "@/lib/server/participant-questions";

/** The signed-in traveler's own questions on this trip (published, closed or cancelled). Never anyone else's, never drafts. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { const { slug } = await params; return NextResponse.json({ questions: await authenticatedMyParticipantQuestions(slug) }, { headers: participantQuestionHeaders }); }
  catch (error) { return participantQuestionErrorResponse(error); }
}
