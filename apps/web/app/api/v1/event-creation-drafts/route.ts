import { EventCreationDraftSchema } from "@commons/contracts";
import { NextResponse } from "next/server";
import { entryFromContext, entryFromParam } from "@/lib/beta/attribution";
import { recordBetaAttribution } from "@/lib/server/beta-completion";
import { createAuthenticatedEventDraft } from "@/lib/server/event-creation";
import { eventCreationErrorResponse } from "@/lib/server/event-creation-response";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const draft = await createAuthenticatedEventDraft(body);
    // Beta rework (no-op with the flag off): one privacy-safe "draft started" per draft. The optional `entry` ("template:girls-trip") is reduced to an
    // allowlisted kind and catalog slug; nothing else from the request is stored.
    const requested = (body as { entry?: unknown })?.entry;
    const entry = typeof requested === "string" ? entryFromParam(requested) : entryFromContext(draft.entryContext);
    await recordBetaAttribution("draft_started", entry, draft.id);
    return NextResponse.json({ draft: EventCreationDraftSchema.parse(draft) }, { status: 201 });
  } catch (error) {
    return eventCreationErrorResponse(error);
  }
}
