import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/bounded-json";
import { ItineraryPortabilityError, previewAuthenticatedItineraryImport } from "@/lib/server/itinerary-portability";
import { itineraryImportFailure } from "@/lib/server/itinerary-portability-errors";
import { extractCoordinatorSource, SourceReadError, SOURCE_FILE_BYTES } from "@/lib/import/coordinator-source";
import { readBoundedFormData } from "@/lib/import/read-bounded-form-data";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";
export const runtime = "nodejs", maxDuration = 15;
const headers = { "Cache-Control": "private, no-store" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin"), external = new URL(request.url), host = request.headers.get("host"), protocol = request.headers.get("x-forwarded-proto");
  if (host) external.host = host;
  if (protocol === "https" || protocol === "http") external.protocol = protocol + ":";
  if (origin && origin !== external.origin) throw new ItineraryPortabilityError("This request came from another site, so nothing was read or changed.", 403);
}

/** Review only: returns the proposed changes and saves nothing. A file goes through the same bounded source reader as Coordinator attachments. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) { const capabilityBlock = await agentCapabilityBlock((await params).slug); if (capabilityBlock) return capabilityBlock;
  try {
    sameOrigin(request);
    const slug = (await params).slug;
    if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await readBoundedFormData(request, SOURCE_FILE_BYTES + 10_000), file = form.get("file");
      if (!(file instanceof File) || !/\.(md|markdown|txt)$/i.test(file.name)) throw new SourceReadError("Choose a Markdown (.md) or text (.txt) file.");
      const { text } = await extractCoordinatorSource(file);
      return NextResponse.json({ text, preview: await previewAuthenticatedItineraryImport(slug, { threadId: form.get("threadId"), text }) }, { headers });
    }
    const input = await readBoundedJson(request, 64_000);
    return NextResponse.json({ preview: await previewAuthenticatedItineraryImport(slug, input) }, { headers });
  } catch (error) { return itineraryImportFailure(error); }
}
