import { CommandAccessError, CommandConflictError } from "@commons/database";
import { PollRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons";
import { loadAuthenticatedPoll, setAuthenticatedPollStatus } from "@/lib/server/polls";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; pollId: string }> }) {
  try {
    const { slug, pollId } = await params;
    return NextResponse.json({ poll: await loadAuthenticatedPoll(slug, pollId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommonsMembershipRequiredError || error instanceof CommandAccessError || error instanceof PollRepositoryError) return NextResponse.json({ error: "This poll is not available to this account." }, { status: 403 });
    return NextResponse.json({ error: "Poll results could not load." }, { status: 503 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string; pollId: string }> }) {
  try {
    const { slug, pollId } = await params;
    return NextResponse.json({ poll: await setAuthenticatedPollStatus(slug, pollId, await request.json()) });
  } catch (error) {
    if (error instanceof CommandConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof CommandAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check that poll update." }, { status: 400 });
    if (error instanceof PollRepositoryError) return NextResponse.json({ error: error.message }, { status: error.code === "actor_not_authorized" ? 403 : 404 });
    return NextResponse.json({ error: "Poll not updated. Try again." }, { status: 503 });
  }
}
