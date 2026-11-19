import { EventCreationDraftSchema } from "@commons/contracts";
import { NextResponse } from "next/server";
import { createAuthenticatedEventDraft } from "@/lib/server/event-creation";
import { eventCreationErrorResponse } from "@/lib/server/event-creation-response";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const draft = await createAuthenticatedEventDraft(body);
    return NextResponse.json({ draft: EventCreationDraftSchema.parse(draft) }, { status: 201 });
  } catch (error) {
    return eventCreationErrorResponse(error);
  }
}
