import { RecentReusableEventsSchema } from "@commons/contracts";
import { NextResponse } from "next/server";
import { loadRecentEventsForCreation } from "@/lib/server/event-creation";
import { eventCreationErrorResponse } from "@/lib/server/event-creation-response";

export async function GET() {
  try {
    return NextResponse.json({ events: RecentReusableEventsSchema.parse(await loadRecentEventsForCreation()) });
  } catch (error) {
    return eventCreationErrorResponse(error);
  }
}
