import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistCommonsArchived,
} from "@/lib/server/commons";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const snapshot = await persistCommonsArchived(slug, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Trip status not changed. Try again." }, { status: 400 });
    }
    if (error instanceof CommonsRepositoryError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "commons_not_found" ? 404 : 403 },
      );
    }
    return NextResponse.json({ error: "Trip status not changed. Try again." }, { status: 503 });
  }
}
