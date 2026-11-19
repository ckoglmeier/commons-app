import { z } from "zod";
import { dismissGoalSuggestion } from "@commons/database";
import { authenticatedGoalOptions } from "@/lib/server/polls";
import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/bounded-json";
import { legacyCoordinatorErrorResponse } from "@/lib/server/coordinator-errors";
import { GoalCapabilityUnavailableError, authenticatedGoalOperation, authenticatedGoals } from "@/lib/server/coordinator-goal-service";
import { coordinatorGoalsAvailableFor } from "@/lib/server/goal-access";
import { agentCapabilityBlock, capabilityUnavailableResponse } from "@/lib/server/trip-capabilities";
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ slug: string }> };
export async function GET(_request: Request, context: Context) {
  try { const { slug } = await context.params; return NextResponse.json({ enabled: await coordinatorGoalsAvailableFor(slug), ...await authenticatedGoals(slug) }, { headers }); }
  catch (error) { return legacyCoordinatorErrorResponse(error); }
}
export async function POST(request: Request, context: Context) { const capabilityBlock = await agentCapabilityBlock((await context.params).slug, "goals"); if (capabilityBlock) return capabilityBlock;
  try { const { slug } = await context.params; return NextResponse.json(await authenticatedGoalOperation(slug, await readBoundedJson(request, 6_000)), { headers }); }
  catch (error) { if (error instanceof GoalCapabilityUnavailableError) return capabilityUnavailableResponse(); return legacyCoordinatorErrorResponse(error); }
}

export async function PATCH(request:Request,context:Context){ const capabilityBlock = await agentCapabilityBlock((await context.params).slug); if (capabilityBlock) return capabilityBlock;try{const {slug}=await context.params;if(!await coordinatorGoalsAvailableFor(slug))return NextResponse.json({error:"Tasks are unavailable."},{status:403});const input=z.object({ideaId:z.string().uuid(),expectedFingerprint:z.string()}).strict().parse(await readBoundedJson(request,1000));return NextResponse.json(await dismissGoalSuggestion(slug,input,await authenticatedGoalOptions(slug)),{headers});}catch(error){return legacyCoordinatorErrorResponse(error);}}
