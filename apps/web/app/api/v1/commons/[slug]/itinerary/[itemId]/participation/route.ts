import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistParticipation,
} from "@/lib/server/commons";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; itemId: string }> },
) {
  try {
    const { slug, itemId } = await params;
    const snapshot = await persistParticipation(slug, itemId, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Response not saved. Choose in, maybe, or skip." }, { status: 400 });
    }
    if (error instanceof CommonsRepositoryError) {
      const status = error.code === "commons_not_found" || error.code === "itinerary_not_found" ? 404 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "Response not saved. Try again." }, { status: 503 });
  }
}
