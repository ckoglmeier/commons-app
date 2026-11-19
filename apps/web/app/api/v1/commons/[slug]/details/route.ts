import { CommandConflictError, CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistDetailsUpdate,
} from "@/lib/server/commons";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const snapshot = await persistDetailsUpdate(slug, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof CommandConflictError) return NextResponse.json({ error: "Trip settings changed. Reload the trip before trying again." }, { status: 409 });
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Check the trip details and try again." },
        { status: 400 },
      );
    }
    if (error instanceof CommonsRepositoryError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "commons_not_found" ? 404 : 403 },
      );
    }
    return NextResponse.json({ error: "Trip details not updated. Try again." }, { status: 503 });
  }
}
