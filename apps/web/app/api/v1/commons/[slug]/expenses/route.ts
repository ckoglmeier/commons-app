import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistExpense,
} from "@/lib/server/commons";
import { recordOutcome, recordOperationFailure } from "@/lib/server/outcome-telemetry";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const input = await request.json();
    const snapshot = await persistExpense(slug, input);
    recordOutcome({ event: "expense_added", key: String((input as { commandId?: unknown })?.commandId ?? ""), trip: slug, request, properties: { balanceMode: (input as { balanceMode?: unknown })?.balanceMode } });
    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Expense not added. Check the amount and split." },
        { status: 400 },
      );
    }
    if (error instanceof CommonsRepositoryError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "commons_not_found" ? 404 : error.code === "expense_ledger_closed" ? 409 : 403 },
      );
    }
    recordOperationFailure({ operation: "expense_save", error, trip: (await params).slug, request });
    return NextResponse.json(
      { error: "Expense not added. Try again." },
      { status: 503 },
    );
  }
}
