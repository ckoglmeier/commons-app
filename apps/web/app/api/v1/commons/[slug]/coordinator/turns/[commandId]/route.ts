import { NextResponse } from "next/server";
import { z } from "zod";
import { coordinatorErrorResponse } from "@/lib/server/coordinator-errors";
import { lookupCoordinatorTurn } from "@/lib/server/coordinator-turn-service";
import { CoordinatorTurnError } from "@commons/database";

const headers = { "Cache-Control": "private, no-store" };

/** After a timeout or reload: what happened to this command? Never repeats work. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; commandId: string }> }) {
  try {
    const { slug, commandId } = await params;
    z.string().uuid().parse(commandId);
    const result = await lookupCoordinatorTurn(slug, commandId);
    if (!result) throw new CoordinatorTurnError("artifact_missing");
    return NextResponse.json(result, { headers });
  } catch (error) { return coordinatorErrorResponse(error); }
}
