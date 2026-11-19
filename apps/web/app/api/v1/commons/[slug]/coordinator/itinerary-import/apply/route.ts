import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/bounded-json";
import { applyAuthenticatedItineraryImport } from "@/lib/server/itinerary-portability";
import { itineraryImportFailure } from "@/lib/server/itinerary-portability-errors";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";

/** Saves only the chosen changes through the existing versioned itinerary command. Retrying with the same commandId never duplicates. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) { const capabilityBlock = await agentCapabilityBlock((await params).slug); if (capabilityBlock) return capabilityBlock;
  try {
    const slug = (await params).slug;
    return NextResponse.json({ receipt: await applyAuthenticatedItineraryImport(slug, await readBoundedJson(request, 64_000)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return itineraryImportFailure(error); }
}
