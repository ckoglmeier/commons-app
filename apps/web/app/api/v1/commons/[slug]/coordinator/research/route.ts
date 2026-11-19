import { NextResponse } from "next/server";
import { z } from "zod";
import { QueueWorkspaceResearchSchema } from "@commons/contracts";
import { CommandConflictError, CoordinatorConflictError } from "@commons/database";
import { readBoundedJson } from "@/lib/bounded-json";
import { authenticatedResearchTasks, cancelAuthenticatedResearch, queueAuthenticatedResearch } from "@/lib/server/polls";
import { legacyCoordinatorErrorResponse } from "@/lib/server/coordinator-errors";
import { coordinatorResearchEnabled, readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ slug: string }> };
function failure(error: unknown) {
  // Same stable codes and distinct copy as the turn routes; only the queue-conflict wording stays research-specific.
  if (error instanceof CommandConflictError && !(error instanceof CoordinatorConflictError)) {
    return NextResponse.json({ error: "Research could not be queued. Check existing tasks before trying again.", code: "stale_version", retryable: true }, { status: 409, headers });
  }
  return legacyCoordinatorErrorResponse(error);
}
export async function GET(request: Request, context: Context) {
  try { const { slug } = await context.params;
    const threadId = z.string().uuid().parse(new URL(request.url).searchParams.get("threadId"));
    return NextResponse.json(await authenticatedResearchTasks(slug, threadId), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) { const capabilityBlock = await agentCapabilityBlock((await context.params).slug); if (capabilityBlock) return capabilityBlock;
  try { const { slug } = await context.params;
    const input = QueueWorkspaceResearchSchema.parse(await readBoundedJson(request, 3000));
    // Authenticate before reporting provider configuration.
    await authenticatedResearchTasks(slug, input.threadId);
    const environment = readCommonsRuntimeEnvironment();
    if (!coordinatorResearchEnabled(environment) || environment.COMMONS_DURABLE_RESEARCH_ENABLED !== "true" || !environment.TAVILY_API_KEY) {
      return NextResponse.json({ error: "Background research is not connected yet." }, { status: 503, headers });
    }
    return NextResponse.json(await queueAuthenticatedResearch(slug, input), { status: 202, headers });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request, context: Context) { const capabilityBlock = await agentCapabilityBlock((await context.params).slug); if (capabilityBlock) return capabilityBlock;
  try { const { slug } = await context.params;
    const input = z.object({ threadId: z.string().uuid(), taskId: z.string().uuid() }).strict().parse(await readBoundedJson(request, 1000));
    return NextResponse.json(await cancelAuthenticatedResearch(slug, input.threadId, input.taskId), { headers });
  } catch (error) { return failure(error); }
}
