import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistStayDelete,
  persistStayUpdate,
} from "@/lib/server/commons";

function errorResponse(error: unknown, action: "updated" | "removed") {
  if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? `Stay not ${action}. Check each field.` }, { status: 400 });
  }
  if (error instanceof CommonsRepositoryError) {
    const status = error.code === "commons_not_found" || error.code === "stay_not_found" ? 404 : 403;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ error: `Stay not ${action}. Try again.` }, { status: 503 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; stayId: string }> },
) {
  try {
    const { slug, stayId } = await params;
    const snapshot = await persistStayUpdate(slug, stayId, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    return errorResponse(error, "updated");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; stayId: string }> },
) {
  try {
    const { slug, stayId } = await params;
    const snapshot = await persistStayDelete(slug, stayId, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    return errorResponse(error, "removed");
  }
}
