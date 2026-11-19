import { NextResponse } from "next/server";
import { z } from "zod";
import { readBoundedJson } from "@/lib/bounded-json";
import { legacyCoordinatorErrorResponse } from "@/lib/server/coordinator-errors";
import { coordinatorWorkspaceEnabled, saveAuthenticatedPollDraft } from "@/lib/server/polls";
import { loadCommonsSnapshot } from "@/lib/server/commons";
import { CoordinatorTurnError } from "@commons/database";
import { newItineraryDraft } from "@/lib/itinerary-workshop";
import { createHash } from "node:crypto";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";

/**
 * Starts an explicit Ask-the-group draft. `threadId` (optional) creates the draft inside that organizer thread, so the
 * following turn never has to reconcile two association rules. Failures keep their real cause: auth, membership,
 * thread, and validation errors are no longer collapsed into one message.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) { const capabilityBlock = await agentCapabilityBlock((await params).slug); if (capabilityBlock) return capabilityBlock;
  try {
    const { slug } = await params;
    if (!await coordinatorWorkspaceEnabled(slug)) throw new CoordinatorTurnError("unsupported_capability");
    const input = z.object({ id: z.string().uuid(), prompt: z.string().trim().min(1).max(2000), threadId: z.string().uuid().optional(), kind: z.enum(["poll", "itinerary"]).default("poll") }).parse(await readBoundedJson(request, 10_000));
    const snapshot = await loadCommonsSnapshot(slug);
    if (!snapshot) throw new CoordinatorTurnError("membership_lost");
    if (snapshot.currentActor.role !== "organizer") throw new CoordinatorTurnError("organizer_required");
    const trip = snapshot.commons;
    let sequence = 0;
    const stableId = () => { const hex = createHash("sha256").update(`${input.id}:${sequence++}`).digest("hex"); return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`; };
    const draft = await saveAuthenticatedPollDraft(slug, { id: input.id, commandId: input.id, expectedVersion: 0, data: input.kind === "itinerary" ? newItineraryDraft(`${trip.name.slice(0,100)} itinerary`, stableId) : {
      title: "New group question", intro: null, ballotMode: "transparent", questions: [], presentationVersion: 2,
      settledFacts: [trip.startsOn ? `Recorded trip dates: ${trip.startsOn}${trip.endsOn ? ` to ${trip.endsOn}` : ""}.` : "Trip dates are not set.", trip.locationName ? `Recorded destination: ${trip.locationName}.` : "Destination is not set.", trip.lodging ? `Recorded stay: ${trip.lodging.name}.` : "", "These are current trip records, not new commitments. Clarify before changing them."].filter(Boolean).join(" "),
      communication: { heading: "New group question", paragraphs: input.prompt.match(/[\s\S]{1,1500}/g), links: [] },
    } }, input.threadId);
    return NextResponse.json({ draft }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return legacyCoordinatorErrorResponse(error); }
}
