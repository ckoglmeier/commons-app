import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistReimbursement,
} from "@/lib/server/commons";
import { recordOutcome, recordOperationFailure } from "@/lib/server/outcome-telemetry";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const input = await request.json();
    const snapshot = await persistReimbursement(slug, input);
    recordOutcome({ event: "payment_recorded", key: String((input as { commandId?: unknown })?.commandId ?? ""), trip: slug, request, properties: {} });
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
        { error: "Payment not recorded. Check the people and amount." },
        { status: 400 },
      );
    }
    if (error instanceof CommonsRepositoryError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "commons_not_found" ? 404 : 403 },
      );
    }
    recordOperationFailure({ operation: "payment_record", error, trip: (await params).slug, request });
    return NextResponse.json(
      { error: "Payment not recorded. Try again." },
      { status: 503 },
    );
  }
}
