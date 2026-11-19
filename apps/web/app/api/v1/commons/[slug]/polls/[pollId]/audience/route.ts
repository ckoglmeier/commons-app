import { NextResponse } from "next/server";
import { CommandAccessError, CommandConflictError, PollRepositoryError } from "@commons/database";
import { ZodError } from "zod";
import { revokeAuthenticatedPollRecipient } from "@/lib/server/polls";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons";
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; pollId: string }> }) {
  try { const { slug, pollId } = await params; return NextResponse.json({ poll: await revokeAuthenticatedPollRecipient(slug, pollId, await request.json()) }); }
  catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "This poll is not available to your account." }, { status: 403 });
    if (error instanceof PollRepositoryError || error instanceof CommandConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof ZodError) return NextResponse.json({ error: "Review the recipient before removing access." }, { status: 400 });
    return NextResponse.json({ error: "Access not changed. Try again." }, { status: 503 });
  }
}
