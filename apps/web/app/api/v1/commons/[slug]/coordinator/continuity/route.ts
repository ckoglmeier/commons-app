import { NextResponse } from "next/server";
import { z } from "zod";
import { LinkOutcomeRequestSchema, StartSubthreadRequestSchema } from "@commons/contracts";
import { TaskNotAmendableError } from "@commons/database";
import { readBoundedJson } from "@/lib/bounded-json";
import { legacyCoordinatorErrorResponse } from "@/lib/server/coordinator-errors";
import { taskCapability } from "@/lib/server/coordinator-task-service";
import { authenticatedThreadOutcomes, authenticatedThreadRelations, ensureAuthenticatedMainThread, linkAuthenticatedTaskOutcome, startAuthenticatedSubthread } from "@/lib/server/polls";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";

const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ slug: string }> };
const off = () => NextResponse.json({ error: "This isn’t available yet.", code: "steering_off", retryable: false }, { status: 404, headers });

/** The main conversation, how threads relate, and the outcomes linked into the thread being viewed. Needs steering on (it reads tables only that release uses). */
export async function GET(request: Request, context: Context) { const capabilityBlock = await agentCapabilityBlock((await context.params).slug); if (capabilityBlock) return capabilityBlock;
  try {
    const { slug } = await context.params;
    if (!taskCapability().steering) return off();
    const threadId = new URL(request.url).searchParams.get("threadId");
    const [main, relations, outcomes] = await Promise.all([ensureAuthenticatedMainThread(slug), authenticatedThreadRelations(slug), threadId ? authenticatedThreadOutcomes(slug, z.string().uuid().parse(threadId)) : Promise.resolve([])]);
    return NextResponse.json({ mainThreadId: main.id, relations, outcomes }, { headers });
  } catch (error) { return legacyCoordinatorErrorResponse(error); }
}

/** Start a subthread the organizer asked for (`subthread`), or show a finished subthread task's current outcome once in the main conversation (`link_outcome`). */
export async function POST(request: Request, context: Context) { const capabilityBlock = await agentCapabilityBlock((await context.params).slug); if (capabilityBlock) return capabilityBlock;
  try {
    const { slug } = await context.params;
    if (!taskCapability().steering) return off();
    const body = await readBoundedJson(request, 4_000);
    if (typeof body === "object" && body !== null && (body as { op?: unknown }).op === "link_outcome") {
      const rest = { ...(body as Record<string, unknown>) };
      delete rest.op;
      const input = LinkOutcomeRequestSchema.extend({ threadId: z.string().uuid() }).parse(rest);
      try { return NextResponse.json(await linkAuthenticatedTaskOutcome(slug, input.threadId, { taskId: input.taskId, revision: input.revision }), { headers }); }
      catch (error) {
        if (error instanceof TaskNotAmendableError) return NextResponse.json({ error: "That result isn’t current any more, so it wasn’t added to the main conversation.", code: "outcome_not_current", retryable: false }, { status: 409, headers });
        throw error;
      }
    }
    const input = StartSubthreadRequestSchema.parse(body);
    const created = await startAuthenticatedSubthread(slug, { commandId: input.commandId, title: input.title, brief: input.brief, parentThreadId: input.parentThreadId, briefTaskIds: input.briefTaskIds, ...(input.threadId ? { id: input.threadId } : {}) });
    return NextResponse.json(created, { status: created.replayed ? 200 : 201, headers });
  } catch (error) { return legacyCoordinatorErrorResponse(error); }
}
