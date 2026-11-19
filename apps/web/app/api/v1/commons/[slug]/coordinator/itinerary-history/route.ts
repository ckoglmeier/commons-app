import { NextResponse } from "next/server";
import { z } from "zod";
import { readItineraryDocumentRevisions, readLegacyItineraryRevisions } from "@commons/database";
import { authenticatedGoalOptions } from "@/lib/server/polls";
import { legacyCoordinatorErrorResponse } from "@/lib/server/coordinator-errors";
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const slug = (await params).slug, query = new URL(request.url).searchParams;
    if (query.get("legacy") === "1") return NextResponse.json({ revisions: await readLegacyItineraryRevisions(slug, z.string().uuid().parse(query.get("documentId")), await authenticatedGoalOptions(slug)) }, { headers: { "Cache-Control": "private, no-store" } });
    const revisions = await readItineraryDocumentRevisions(slug, z.string().uuid().parse(query.get("threadId")), z.string().uuid().parse(query.get("documentId")), await authenticatedGoalOptions(slug));
    return NextResponse.json({ revisions }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return legacyCoordinatorErrorResponse(error); }
}
