import { NextResponse } from "next/server";
import { CommandAccessError } from "@commons/database";
import { readBoundedJson } from "@/lib/bounded-json";
import { authenticatedGoalParticipantQuestions, authenticatedParticipantQuestionRecipients, operateAuthenticatedParticipantQuestion, participantQuestionErrorResponse, participantQuestionHeaders, participantQuestionsAvailableFor } from "@/lib/server/participant-questions";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";

type Context = { params: Promise<{ slug: string; goalId: string }> };

/** The task audience's view of this task's questions: active organizers only; the asker's drafts are private to the asker. */
export async function GET(_request: Request, context: Context) {
  try {
    const { slug, goalId } = await context.params;
    const enabled = await participantQuestionsAvailableFor(slug), questions = await authenticatedGoalParticipantQuestions(slug, goalId);
    // Who can be asked: other active members, by name. Only while asking is enabled.
    return NextResponse.json({ enabled, questions, recipients: enabled ? await authenticatedParticipantQuestionRecipients(slug) : [] }, { headers: participantQuestionHeaders });
  } catch (error) { return participantQuestionErrorResponse(error); }
}

/** prepare | publish | cancel. Publishing makes the exact saved version available on the web; it sends nothing. */
export async function POST(request: Request, context: Context) { const capabilityBlock = await agentCapabilityBlock((await context.params).slug, "goals"); if (capabilityBlock) return capabilityBlock;
  try {
    const { slug, goalId } = await context.params;
    const body = await readBoundedJson(request, 4_000) as Record<string, unknown>;
    if (body && typeof body === "object" && "goalId" in body && body.goalId !== goalId) throw new CommandAccessError();
    return NextResponse.json(await operateAuthenticatedParticipantQuestion(slug, body.action === "prepare" ? { ...body, goalId } : body), { headers: participantQuestionHeaders });
  } catch (error) { return participantQuestionErrorResponse(error); }
}
