import { NextResponse } from "next/server";
import { z } from "zod";
import { coordinatorErrorResponse } from "@/lib/server/coordinator-errors";
import { stopAuthenticatedCoordinatorTurn } from "@/lib/server/polls";
import { stopRunningTurn } from "@/lib/server/coordinator-turn-stream";
import { turnResultFromRecord } from "@/lib/server/coordinator-turn-service";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";

const headers = { "Cache-Control": "private, no-store" };

/**
 * Author-scoped Stop. The database decides first, under the turn row lock: either this attempt is ended (and stays ended, on every instance, because
 * completion is attempt-guarded under the same lock) or it had already finished and that saved result is returned. Only then is a turn running in this
 * instance told to stop, which saves provider work but decides nothing. A completed result is never undone.
 *
 * `stopped` keeps its meaning for older clients; `outcome` and `result` are additive.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ slug: string; commandId: string }> }) { const capabilityBlock = await agentCapabilityBlock((await params).slug); if (capabilityBlock) return capabilityBlock;
  try {
    const { slug, commandId } = await params;
    z.string().uuid().parse(commandId);
    const { outcome, turn } = await stopAuthenticatedCoordinatorTurn(slug, commandId);
    if (outcome === "stopped") stopRunningTurn(commandId);
    return NextResponse.json({ stopped: outcome === "stopped", outcome, result: turnResultFromRecord(turn) }, { headers });
  } catch (error) { return coordinatorErrorResponse(error); }
}
