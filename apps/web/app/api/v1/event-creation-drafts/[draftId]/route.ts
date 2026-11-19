import { EventCreationDraftSchema } from "@commons/contracts";
import { NextResponse } from "next/server";
import {
  loadAuthenticatedEventDraft,
  updateAuthenticatedEventDraft,
} from "@/lib/server/event-creation";
import { eventCreationErrorResponse } from "@/lib/server/event-creation-response";

export async function GET(_request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const { draftId } = await params;
    return NextResponse.json({ draft: EventCreationDraftSchema.parse(await loadAuthenticatedEventDraft(draftId)) });
  } catch (error) {
    return eventCreationErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const { draftId } = await params;
    const draft = await updateAuthenticatedEventDraft(draftId, await request.json());
    return NextResponse.json({ draft: EventCreationDraftSchema.parse(draft) });
  } catch (error) {
    return eventCreationErrorResponse(error);
  }
}
