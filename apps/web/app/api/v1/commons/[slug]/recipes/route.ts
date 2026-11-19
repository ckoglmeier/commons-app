import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/bounded-json";
import { loadAuthenticatedRecipeRuns, recipeFailure, startAuthenticatedRecipeRun } from "@/lib/server/recipes";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { return NextResponse.json({ runs: await loadAuthenticatedRecipeRuns((await params).slug) }, { headers }); } catch (error) { return recipeFailure(error); }
}
/** Starts a private organizer draft. Nothing is shared, sent or changed on the trip. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) { const capabilityBlock = await agentCapabilityBlock((await params).slug, "goals"); if (capabilityBlock) return capabilityBlock;
  try { return NextResponse.json(await startAuthenticatedRecipeRun((await params).slug, await readBoundedJson(request, 32_000)), { status: 201, headers }); } catch (error) { return recipeFailure(error); }
}
