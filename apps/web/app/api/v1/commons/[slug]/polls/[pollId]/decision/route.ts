import { NextResponse } from "next/server";
import { CommandAccessError, CommandConflictError, PollRepositoryError } from "@commons/database";
import { ZodError } from "zod";
import { approveAuthenticatedPollDecision } from "@/lib/server/polls";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons";
import { recordOutcome, recordOperationFailure } from "@/lib/server/outcome-telemetry";
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; pollId: string }> }) {
  try {
    const { slug, pollId } = await params, input = await request.json() as { commandId?: unknown; target?: unknown };
    const poll = await approveAuthenticatedPollDecision(slug, pollId, input);
    recordOutcome({ event: "poll_decision_recorded", key: `${pollId}:${String(input?.commandId ?? "")}`, trip: slug, request, properties: { target: input?.target } });
    return NextResponse.json({ poll });
  }
  catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "This poll is not available to your account." }, { status: 403 });
    if (error instanceof PollRepositoryError || error instanceof CommandConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Review the decision and its scope." }, { status: 400 });
    recordOperationFailure({ operation: "poll_decision", error, trip: (await params).slug, request });
    return NextResponse.json({ error: "Decision not approved. Try again." }, { status: 503 });
  }
}
