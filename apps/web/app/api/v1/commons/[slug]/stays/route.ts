import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistStay,
} from "@/lib/server/commons";
import { recordOutcome, recordOperationFailure } from "@/lib/server/outcome-telemetry";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const input = await request.json();
    const snapshot = await persistStay(slug, input);
    recordOutcome({ event: "plan_item_saved", key: String((input as { commandId?: unknown })?.commandId ?? ""), trip: slug, request, properties: { kind: "stay" } });
    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Stay not added. Check each field." }, { status: 400 });
    }
    if (error instanceof CommonsRepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "commons_not_found" ? 404 : 403 });
    }
    recordOperationFailure({ operation: "plan_item_save", error, trip: (await params).slug, request });
    return NextResponse.json({ error: "Stay not added. Try again." }, { status: 503 });
  }
}
