import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/bounded-json";
import { authenticatedResearchWorkspace } from "@/lib/server/research-workspace";
import { ResearchWorkspaceUnavailable, ResearchWorkspaceAnswerUnchanged } from "@/lib/server/research-workspace-service";
import { ResearchDecisionReviewConflict } from "@/lib/server/research-decision-review";
import { ResearchContextConflict } from "@/lib/server/research-decision-context";
import { legacyCoordinatorErrorResponse } from "@/lib/server/coordinator-errors";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";
const headers = { "Cache-Control": "private, no-store" };
const failure = (error: unknown) => error instanceof ResearchWorkspaceUnavailable
  ? NextResponse.json({ error: "Planned · research unavailable. Nothing was queued.", code: "research_unavailable" }, { status: 503, headers })
  : error instanceof ResearchWorkspaceAnswerUnchanged
    ? NextResponse.json({ error: "These answers are already saved. Change an answer before reviewing an update.", code: "unchanged_answers" }, { status: 422, headers })
  : error instanceof ResearchDecisionReviewConflict
    ? NextResponse.json({ error: "Review the public search wording. Leave out traveler names, private details and exact dates or times.", code: "public_query_needs_review" }, { status: 422, headers })
    : error instanceof ResearchContextConflict
      ? NextResponse.json({ error: "Selected trip details changed or are incomplete. Reload them and review again.", code: "stale_version" }, { status: 409, headers })
      : legacyCoordinatorErrorResponse(error);
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params, url = new URL(request.url), service = authenticatedResearchWorkspace(slug);
    if (url.searchParams.has("commandId")) return NextResponse.json({ history: await service.command(url.searchParams.get("commandId")!) }, { headers });
    if (url.searchParams.has("goalId")) return NextResponse.json({ history: await service.goal(url.searchParams.get("goalId")!) }, { headers });
    return NextResponse.json(await service.choices(), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) { const capabilityBlock = await agentCapabilityBlock((await context.params).slug); if (capabilityBlock) return capabilityBlock;
  try {
    const { slug } = await context.params, url = new URL(request.url), body = await readBoundedJson(request, 16_000), service = authenticatedResearchWorkspace(slug);
    // Preparing never executes. Starting only invokes the durable human review
    // command after independent runner and saved-context checks.
    if (url.searchParams.get("action") === "prepare") return NextResponse.json(await service.prepare(body), { headers });
    if (url.searchParams.get("action") === "start") return NextResponse.json(await service.start(body), { headers });
    if (url.searchParams.get("action") === "prepare-answer") return NextResponse.json(await service.prepareAnswer(body), { headers });
    if (url.searchParams.get("action") === "answer") return NextResponse.json(await service.answer(body), { headers });
    return NextResponse.json({ error: "Choose prepare or start.", code: "invalid_request" }, { status: 400, headers });
  } catch (error) { return failure(error); }
}
