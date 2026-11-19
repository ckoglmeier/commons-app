import { NextResponse } from "next/server";
import { loadAuthenticatedTransportReview, recipeFailure } from "@/lib/server/recipes";

/** Read-only ride suggestions. Nothing is saved, assigned or sent. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const minutes = Number(new URL(request.url).searchParams.get("window"));
    return NextResponse.json({ review: await loadAuthenticatedTransportReview((await params).slug, Number.isFinite(minutes) && minutes > 0 ? minutes : undefined) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return recipeFailure(error); }
}
