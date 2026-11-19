import { NextResponse } from "next/server";
import { loadAuthenticatedRecipeRun, recipeFailure } from "@/lib/server/recipes";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; runId: string }> }) {
  try { const { slug, runId } = await params; return NextResponse.json({ run: await loadAuthenticatedRecipeRun(slug, runId) }, { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return recipeFailure(error); }
}
