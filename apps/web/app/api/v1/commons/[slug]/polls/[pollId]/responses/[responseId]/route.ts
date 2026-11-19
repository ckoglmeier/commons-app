import { PollRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons";
import { removeAuthenticatedPollResponse } from "@/lib/server/polls";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string; pollId: string; responseId: string }> },
) {
  try {
    const { slug, pollId, responseId } = await params;
    return NextResponse.json({ poll: await removeAuthenticatedPollResponse(slug, pollId, responseId) });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof PollRepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "actor_not_authorized" ? 403 : 404 });
    }
    return NextResponse.json({ error: "Poll response not deleted. Try again." }, { status: 503 });
  }
}
