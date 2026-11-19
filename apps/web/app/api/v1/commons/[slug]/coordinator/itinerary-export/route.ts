import { NextResponse } from "next/server";
import { z } from "zod";
import { legacyCoordinatorErrorResponse } from "@/lib/server/coordinator-errors";
import { exportAuthenticatedItinerary, ItineraryPortabilityError } from "@/lib/server/itinerary-portability";

/** Readable Markdown of the participant-visible itinerary fields, with versioned matching details. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const slug = (await params).slug, query = new URL(request.url).searchParams;
    const exported = await exportAuthenticatedItinerary(slug, z.string().uuid().parse(query.get("threadId")), z.string().uuid().parse(query.get("documentId")));
    return new NextResponse(exported.markdown, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "X-Commons-Itinerary-Version": String(exported.version), ...(query.get("download") === "1" ? { "Content-Disposition": `attachment; filename="${exported.filename}"` } : {}) } });
  } catch (error) {
    if (error instanceof ItineraryPortabilityError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    return legacyCoordinatorErrorResponse(error);
  }
}
