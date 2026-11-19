import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CoordinatorTurnRequestSchema } from "@commons/contracts";
import { CommandConflictError, CoordinatorAccessError, CoordinatorConflictError, CoordinatorTurnError, LodgingReviewStaleError } from "@commons/database";
import { COORDINATOR_WORKSPACE_BODY_LIMIT, readBoundedJson } from "@/lib/bounded-json";
import { renderTripContextForModel } from "@/lib/server/coordinator-context-prompt";
import { coordinatorErrorCode, CoordinatorProviderError, legacyCoordinatorErrorResponse } from "@/lib/server/coordinator-errors";
import { coordinatorProviderReady, routeAndDispatch } from "@/lib/server/coordinator-capabilities";
import { runCoordinatorTurn } from "@/lib/server/coordinator-turn-service";
import { actOnAuthenticatedCoordinatorWorkspace, commitAuthenticatedCoordinatorTurn, coordinatorWorkspaceEnabled, hasAuthenticatedCoordinatorReplay, loadAuthenticatedCoordinatorThread, loadAuthenticatedTripContext, reserveAuthenticatedCoordinatorInference } from "@/lib/server/polls";
import { coordinatorTripChangesEnabled, readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";

export const maxDuration = 180;
const headers = { "Cache-Control": "private, no-store" };
const failure = legacyCoordinatorErrorResponse;

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const search = new URL(request.url).searchParams, before = search.get("before"), threadId = search.get("threadId") ?? undefined;
    return NextResponse.json(await loadAuthenticatedCoordinatorThread(slug, before === null ? undefined : Number(before), threadId), { headers });
  } catch (error) { return failure(error); }
}

/**
 * Compatibility adapter for the current Workspace UI (until Stage 5). A request with `threadId` is a
 * thread turn: it becomes a TurnCommand and runs through the turn service, then answers with the legacy
 * thread payload. A request without `threadId` is a legacy unthreaded draft/poll/note context: it keeps
 * its legacy persistence but uses the same context assembler, dispatch, and error codes.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) { const capabilityBlock = await agentCapabilityBlock((await params).slug); if (capabilityBlock) return capabilityBlock;
  let stage = "load";
  try {
    const { slug } = await params;
    const input = CoordinatorTurnRequestSchema.parse(await readBoundedJson(request, 10_000));
    if (input.threadId) {
      stage = "turn";
      if ([input.draftId, input.contextPollId, input.contextTurnId].filter(Boolean).length > 1) throw new CoordinatorTurnError("invalid_request");
      const result = await runCoordinatorTurn(slug, {
        commandId: input.commandId, target: { kind: "existing", threadId: input.threadId, expectedTurnVersion: input.version }, inputMode: "text", text: input.prompt,
        ...(input.draftId && input.draftVersion ? { artifact: { kind: "draft", id: input.draftId, version: input.draftVersion } }
          : input.contextPollId ? { artifact: { kind: "poll", id: input.contextPollId } }
          : input.contextTurnId ? { artifact: { kind: "note", turnId: input.contextTurnId } } : {}),
        ...(input.researchQuery ? { explicitAction: { kind: "research", query: input.researchQuery } } : {}),
      }, { signal: request.signal, request });
      // The request is saved even when the answer failed; the legacy client still needs the error and its stable code.
      if (result.status === "failed") throw new CoordinatorTurnError(result.error!.code);
      return NextResponse.json(await loadAuthenticatedCoordinatorThread(slug, undefined, input.threadId), { headers });
    }
    if (await hasAuthenticatedCoordinatorReplay(slug, input)) return NextResponse.json(await loadAuthenticatedCoordinatorThread(slug, undefined, input.threadId), { headers });
    if (!coordinatorProviderReady(input.prompt, input.researchQuery, false).ok) throw new CoordinatorProviderError("provider_not_configured");
    const thread = await loadAuthenticatedCoordinatorThread(slug, undefined, undefined);
    if (input.contextPollId && !thread.polls.some(poll => poll.id === input.contextPollId)) throw new CoordinatorAccessError("artifact_missing");
    if (input.contextTurnId && !thread.turns.some(turn => turn.id === input.contextTurnId && turn.workspace?.saved)) throw new CoordinatorAccessError("artifact_missing");
    stage = "reserve";
    if ((await reserveAuthenticatedCoordinatorInference(slug, input)).replayed) return NextResponse.json(await loadAuthenticatedCoordinatorThread(slug, undefined, input.threadId), { headers });
    if (thread.version !== input.version) throw new CoordinatorConflictError("stale_version");
    const draft = input.draftId ? thread.drafts.find(item => item.id === input.draftId) : null;
    if (input.draftId && !draft) throw new CoordinatorAccessError("artifact_missing");
    stage = "context";
    const snapshot = await loadAuthenticatedTripContext(slug);
    const rendered = renderTripContextForModel(snapshot, { maxChars: 6_000 });
    const contextKey = input.draftId ? `draft:${input.draftId}` : input.contextPollId ? `poll:${input.contextPollId}` : input.contextTurnId ? `note:${input.contextTurnId}` : "trip";
    stage = "inference";
    const { result: outcome } = await routeAndDispatch({ slug, prompt: input.prompt, commandId: input.commandId, inputMode: "text",
      ...(input.researchQuery ? { explicitAction: { kind: "research" as const, query: input.researchQuery } } : {}),
      contextKey, thread, threadId: null, draft: draft ?? null, contextPollId: input.contextPollId, context: { snapshot, ...rendered },
      wantTopicTitle: false, wantThreadSummary: false, request, signal: request.signal },
      { tripChangesEnabled: coordinatorTripChangesEnabled(slug), researchConfigured: Boolean(readCommonsRuntimeEnvironment().TAVILY_API_KEY) });
    stage = "commit";
    await commitAuthenticatedCoordinatorTurn(slug, input, outcome.assistantText, outcome.data, outcome.workspace);
    stage = "reload";
    return NextResponse.json(await loadAuthenticatedCoordinatorThread(slug, undefined, input.threadId), { headers });
  } catch (error) {
    const response = failure(error);
    // Fixed codes only; no trip IDs, input, error messages, or model output.
    console.warn("commons.coordinator.turn_failed", { stage, status: response.status, reason: coordinatorErrorCode(error) });
    return response;
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) { const capabilityBlock = await agentCapabilityBlock((await params).slug); if (capabilityBlock) return capabilityBlock;
  let tripAction = false, preparingItinerary = false;
  try {
    const { slug } = await params;
    if (!await coordinatorWorkspaceEnabled(slug)) throw new CoordinatorTurnError("unsupported_capability");
    const input = await readBoundedJson(request, COORDINATOR_WORKSPACE_BODY_LIMIT);
    if (input && typeof input === "object" && "action" in input && (input.action === "itinerary" || input.action === "trip_task") && readCommonsRuntimeEnvironment().COMMONS_ASSISTANT_UI_ENABLED !== "true") throw new CoordinatorTurnError("unsupported_capability");
    preparingItinerary = Boolean(input && typeof input === "object" && "action" in input && input.action === "itinerary" && "operation" in input && input.operation === "prepare_poll");
    tripAction = Boolean(input && typeof input === "object" && "action" in input && typeof input.action === "string" && input.action.endsWith("_trip"));
    if (tripAction && !coordinatorTripChangesEnabled(slug)) throw new CoordinatorTurnError("unsupported_capability");
    const result = await actOnAuthenticatedCoordinatorWorkspace(slug, input);
    const threadId = typeof input === "object" && input !== null && "threadId" in input && typeof input.threadId === "string" ? input.threadId : undefined;
    const thread = await loadAuthenticatedCoordinatorThread(slug, undefined, threadId);
    return NextResponse.json({ ...thread, ...(result && "revision" in result ? { itineraryReceipt: result.revision } : {}) }, { headers });
  } catch (error) {
    if (preparingItinerary) console.warn("commons.coordinator.prepare_itinerary_failed", { reason: coordinatorErrorCode(error), status: failure(error).status });
    // Checked before the generic conflict it extends: this refusal has its own cause and its own next step, and nothing was saved.
    if (tripAction && error instanceof LodgingReviewStaleError) return NextResponse.json({ error: "Trip details or shared constraints changed after Commons prepared this stay, so it wasn’t applied. Nothing was saved. Ask Commons for a fresh shortlist.", code: "lodging_review_stale" }, { status: 409, headers });
    if (tripAction && error instanceof CommandConflictError) return NextResponse.json({ error: "A saved trip record or this review changed. Reload and prepare a fresh update; nothing from this attempt was saved." }, { status: 409, headers });
    if (tripAction && error instanceof ZodError) return NextResponse.json({ error: "Review the amount, dates, address, booking link, and included travelers. No trip change was saved." }, { status: 400, headers });
    return failure(error);
  }
}
