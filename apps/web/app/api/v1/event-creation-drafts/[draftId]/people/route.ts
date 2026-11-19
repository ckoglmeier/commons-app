import { EventCreationDraftSchema } from "@commons/contracts";
import { NextResponse } from "next/server";
import { updateAuthenticatedEventDraftPeople } from "@/lib/server/event-creation";
import { eventCreationErrorResponse } from "@/lib/server/event-creation-response";

export async function PUT(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const { draftId } = await params;
    const draft = await updateAuthenticatedEventDraftPeople(draftId, await request.json());
    return NextResponse.json({ draft: EventCreationDraftSchema.parse(draft) });
  } catch (error) {
    return eventCreationErrorResponse(error);
  }
}
