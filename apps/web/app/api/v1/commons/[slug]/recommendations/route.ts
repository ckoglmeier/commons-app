import { NextResponse } from "next/server";
import { CommonsAuthenticationRequiredError } from "@/lib/server/commons";
import { loadAuthenticatedCoordinatorRecommendations } from "@/lib/server/polls";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) { try { return NextResponse.json(await loadAuthenticatedCoordinatorRecommendations((await params).slug), { headers }); } catch (e) { return NextResponse.json({ error: "Private recommendations are unavailable." }, { status: e instanceof CommonsAuthenticationRequiredError ? 401 : 403, headers }); } }
// Recommendations are prepared through the audited operator workflow, not a
// browser write endpoint where a caller could forge its preparation provenance.
export async function POST() { return NextResponse.json({ error: "Recommendations can only be prepared through the audited operator workflow." }, { status: 405, headers }); }
