import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistTripLetterUpdate,
} from "@/lib/server/commons";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const snapshot = await persistTripLetterUpdate(slug, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Check this page’s details." }, { status: 400 });
    }
    if (error instanceof CommonsRepositoryError) {
      const status = error.code === "commons_not_found" ? 404 : error.code === "letter_conflict" ? 409 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "Not saved. Try again." }, { status: 503 });
  }
}
