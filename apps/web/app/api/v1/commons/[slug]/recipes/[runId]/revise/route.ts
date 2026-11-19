import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/bounded-json";
import { reviseAuthenticatedRecipeRound, recipeFailure } from "@/lib/server/recipes";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; runId: string }> }) { const capabilityBlock = await agentCapabilityBlock((await params).slug, "goals"); if (capabilityBlock) return capabilityBlock;
  try { const { slug, runId } = await params; return NextResponse.json(await reviseAuthenticatedRecipeRound(slug, runId, await readBoundedJson(request, 8_000)), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return recipeFailure(error); }
}
