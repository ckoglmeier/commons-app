import { NextResponse } from "next/server";
import { TurnCommandSchema } from "@commons/contracts";
import { readBoundedJson } from "@/lib/bounded-json";
import { coordinatorErrorCode, coordinatorErrorResponse } from "@/lib/server/coordinator-errors";
import { runCoordinatorTurn } from "@/lib/server/coordinator-turn-service";
import { admitDurableCoordinatorTurn, coordinatorDurableTurnStream, coordinatorTurnStream, durableAdmissionAvailable, wantsTurnStream } from "@/lib/server/coordinator-turn-stream";
import { coordinatorStreamingEnabled } from "@/lib/server/runtime-environment";
import { authenticatedCoordinationOptions } from "@/lib/server/polls";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";

export const maxDuration = 180;
const headers = { "Cache-Control": "private, no-store" };

/**
 * One turn, typed or spoken. 200 for a saved turn (completed, or failed with a stable code and a retryable record);
 * a catalog status with `{ error }` only when nothing was saved (auth, membership, stale version, rate limit, ...).
 * With `Accept: text/event-stream` the same turn is reported as typed events (accepted, phase, text, completed | rejected).
 *
 * With COMMONS_DURABLE_COORDINATOR_TURNS_ENABLED and a healthy turn runner, a typed turn is accepted durably instead: this request saves the turn and
 * its execution row together and only observes; the runner executes it in another process. JSON clients get the saved pending turn and look it up.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) { const capabilityBlock = await agentCapabilityBlock((await params).slug); if (capabilityBlock) return capabilityBlock;
  try {
    const { slug } = await params;
    const command = await readBoundedJson(request, 160_000);
    const parsed = TurnCommandSchema.safeParse(command);
    if (parsed.success && await durableAdmissionAvailable(parsed.data)) {
      if (wantsTurnStream(request) && coordinatorStreamingEnabled()) return coordinatorDurableTurnStream(slug, parsed.data, request, await authenticatedCoordinationOptions(slug));
      return NextResponse.json(await admitDurableCoordinatorTurn(slug, parsed.data, request), { headers });
    }
    if (wantsTurnStream(request) && coordinatorStreamingEnabled()) return coordinatorTurnStream(slug, command, request);
    return NextResponse.json(await runCoordinatorTurn(slug, command, { signal: request.signal, request }), { headers });
  } catch (error) {
    const response = coordinatorErrorResponse(error);
    // Fixed codes only; no trip IDs, input, error messages, or model output.
    console.warn("commons.coordinator.turn_failed", { stage: "turns", status: response.status, reason: coordinatorErrorCode(error) });
    return response;
  }
}
