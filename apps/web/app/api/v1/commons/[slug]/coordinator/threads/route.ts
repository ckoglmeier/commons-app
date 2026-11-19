import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/bounded-json";
import { legacyCoordinatorErrorResponse } from "@/lib/server/coordinator-errors";
import { actOnAuthenticatedCoordinatorThreadIdea, authenticatedThreadRelations, createAuthenticatedCoordinatorThread, loadAuthenticatedCoordinatorThread, updateAuthenticatedCoordinatorThread } from "@/lib/server/polls";
import { coordinatorSteeringEnabled } from "@/lib/server/runtime-environment";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";

const headers = { "Cache-Control": "private, no-store" };
const failure = legacyCoordinatorErrorResponse;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) { const capabilityBlock = await agentCapabilityBlock((await params).slug); if (capabilityBlock) return capabilityBlock;
  try {
    const { slug } = await params;
    const created = await createAuthenticatedCoordinatorThread(slug, await readBoundedJson(request, 2_000));
    return NextResponse.json(await loadAuthenticatedCoordinatorThread(slug, undefined, created.id), { status: 201, headers });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) { const capabilityBlock = await agentCapabilityBlock((await params).slug); if (capabilityBlock) return capabilityBlock;
  try {
    const { slug } = await params, input = await readBoundedJson(request, 2_000);
    if (typeof input !== "object" || input === null) throw new SyntaxError();
    // The trip's main conversation is the front door and is never archived; every other thread can be.
    if (coordinatorSteeringEnabled() && (input as { status?: unknown }).status === "archived" && typeof (input as { threadId?: unknown }).threadId === "string"
      && (await authenticatedThreadRelations(slug)).some(relation => relation.kind === "main" && relation.threadId === (input as { threadId: string }).threadId)) {
      return NextResponse.json({ error: "The Trip conversation can’t be archived. Nothing changed.", code: "main_conversation", retryable: false }, { status: 409, headers });
    }
    const result = "action" in input
      ? await actOnAuthenticatedCoordinatorThreadIdea(slug, input)
      : await updateAuthenticatedCoordinatorThread(slug, input);
    const threadId = "id" in result ? result.id : result.threadId;
    return NextResponse.json(await loadAuthenticatedCoordinatorThread(slug, undefined, threadId), { headers });
  } catch (error) { return failure(error); }
}
