import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistExpensesComplete,
  persistExpensesReopen,
} from "@/lib/server/commons";

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof CommonsAuthenticationRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof CommonsMembershipRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: fallback }, { status: 400 });
  }
  if (error instanceof CommonsRepositoryError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.code === "commons_not_found" ? 404 : 403 },
    );
  }
  return NextResponse.json({ error: fallback }, { status: 503 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const snapshot = await persistExpensesComplete(slug, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    return errorResponse(error, "Expenses not marked complete. Try again.");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const snapshot = await persistExpensesReopen(slug, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    return errorResponse(error, "Expenses not reopened. Try again.");
  }
}
