import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistExpenseDelete,
  persistExpenseUpdate,
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
      { error: action === "updated" ? "Expense not updated. Check the amount and split." : "Expense not deleted. Try again." },
      { status: 400 },
    );
  }
  if (error instanceof CommonsRepositoryError) {
    const status = error.code === "commons_not_found" || error.code === "expense_not_found" ? 404 : 403;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(
    { error: `Expense not ${action}. Try again.` },
    { status: 503 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; expenseId: string }> },
) {
  try {
    const { slug, expenseId } = await params;
    const snapshot = await persistExpenseUpdate(slug, expenseId, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    return errorResponse(error, "updated");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; expenseId: string }> },
) {
  try {
    const { slug, expenseId } = await params;
    const snapshot = await persistExpenseDelete(slug, expenseId, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    return errorResponse(error, "deleted");
  }
}
