import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/bounded-json";
import { applyAuthenticatedRecipeOutcome, recipeFailure } from "@/lib/server/recipes";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; runId: string }> }) { const capabilityBlock = await agentCapabilityBlock((await params).slug, "goals"); if (capabilityBlock) return capabilityBlock;
  try { const { slug, runId } = await params; return NextResponse.json(await applyAuthenticatedRecipeOutcome(slug, runId, await readBoundedJson(request, 64_000)), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return recipeFailure(error); }
}
