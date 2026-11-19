import { ZodError } from "zod";
import { CommandAccessError, CommandConflictError, CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistMessage,
} from "@/lib/server/commons";
import { groupMessagesEnabled } from "@/lib/server/runtime-environment";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  // Hidden group messages are closed at the server boundary, before any authentication, parsing, or database work.
  if (!groupMessagesEnabled()) {
    return NextResponse.json({ error: "Group messages are paused in Commons. Nothing was sent.", code: "group_messages_disabled" }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
  try {
    const { slug } = await params;
    const snapshot = await persistMessage(slug, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof CommandConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof CommandAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Message not sent. Check it and try again." },
        { status: 400 },
      );
    }
    if (error instanceof CommonsRepositoryError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "commons_not_found" ? 404 : 403 },
      );
    }
    return NextResponse.json(
      { error: "Message not sent. Try again." },
      { status: 503 },
    );
  }
}
