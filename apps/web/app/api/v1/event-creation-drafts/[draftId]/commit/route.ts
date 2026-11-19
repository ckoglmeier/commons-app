import { CommitEventCreationDraftResultSchema } from "@commons/contracts";
import { NextResponse } from "next/server";
import { commitAuthenticatedEventDraft } from "@/lib/server/event-creation";
import { eventCreationErrorResponse } from "@/lib/server/event-creation-response";
import { recordOutcome, recordOperationFailure } from "@/lib/server/outcome-telemetry";

export async function POST(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const { draftId } = await params;
    const input = await request.json();
    const result = await commitAuthenticatedEventDraft(draftId, input);
    recordOutcome({ event: "trip_created", key: draftId, trip: result.eventId, request, properties: { sendInvitations: Boolean((input as { sendInvitations?: unknown })?.sendInvitations) } });
    return NextResponse.json({ result: CommitEventCreationDraftResultSchema.parse(result) }, { status: 201 });
  } catch (error) {
    recordOperationFailure({ operation: "trip_create", error, request });
    return eventCreationErrorResponse(error);
  }
}
