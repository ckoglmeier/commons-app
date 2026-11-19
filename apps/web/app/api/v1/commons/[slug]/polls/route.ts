import { CommandAccessError, CommandConflictError } from "@commons/database";
import { PollRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { after } from "next/server";
import { ZodError } from "zod";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons";
import { createAuthenticatedPoll } from "@/lib/server/polls";
import { drainPollDeliveries } from "@/lib/server/poll-delivery";
import { commonsSiteOrigin } from "@/lib/server/runtime-environment";
import { readBoundedJson } from "@/lib/bounded-json";
import { recordOutcome, recordOperationFailure } from "@/lib/server/outcome-telemetry";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const poll = await createAuthenticatedPoll(slug, await readBoundedJson(request, 128_000));
    recordOutcome({ event: "poll_published", key: poll.id, trip: slug, request, properties: { questionCount: poll.questions?.length ?? 0, ballotMode: poll.ballotMode } });
    if (poll.communication && poll.audienceReview) after(async () => { try { await drainPollDeliveries(commonsSiteOrigin(), poll.id); } catch { console.error("poll_delivery_worker_failed"); } });
    return NextResponse.json({ poll }, { status: 201 });
  } catch (error) {
    if (error instanceof CommandConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof CommandAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check the poll details." }, { status: 400 });
    if (error instanceof PollRepositoryError) return NextResponse.json({ error: error.message }, { status: error.code === "actor_not_authorized" ? 403 : 409 });
    recordOperationFailure({ operation: "poll_publish", error, trip: (await params).slug, request });
    return NextResponse.json({ error: "Poll not created. Try again." }, { status: 503 });
  }
}
