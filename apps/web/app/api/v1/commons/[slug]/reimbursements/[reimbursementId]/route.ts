import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistReimbursementDelete,
  persistReimbursementUpdate,
} from "@/lib/server/commons";

function errorResponse(error: unknown, action: "updated" | "deleted") {
  if (error instanceof CommonsAuthenticationRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof CommonsMembershipRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: action === "updated" ? "Payment not updated. Check the people and amount." : "Payment not deleted. Try again." },
      { status: 400 },
    );
  }
  if (error instanceof CommonsRepositoryError) {
    const status = error.code === "commons_not_found" || error.code === "reimbursement_not_found" ? 404 : 403;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(
    { error: `Payment not ${action}. Try again.` },
    { status: 503 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; reimbursementId: string }> },
) {
  try {
    const { slug, reimbursementId } = await params;
    const snapshot = await persistReimbursementUpdate(slug, reimbursementId, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    return errorResponse(error, "updated");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; reimbursementId: string }> },
) {
  try {
    const { slug, reimbursementId } = await params;
    const snapshot = await persistReimbursementDelete(slug, reimbursementId, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    return errorResponse(error, "deleted");
  }
}
