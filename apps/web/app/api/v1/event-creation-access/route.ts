import { NextResponse } from "next/server";
import { CommonsAuthenticationRequiredError } from "@/lib/server/commons";
import { requestAuthenticatedEventCreationAccess } from "@/lib/server/event-creation";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { draftId?: unknown };
    const access = await requestAuthenticatedEventCreationAccess(typeof body.draftId === "string" ? body.draftId : undefined);
    return NextResponse.json({ status: access.status }, { status: 201 });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    return NextResponse.json({ error: "Access request not saved. Try again." }, { status: 503 });
  }
}
