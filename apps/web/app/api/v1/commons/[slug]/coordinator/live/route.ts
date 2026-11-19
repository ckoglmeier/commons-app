import { NextResponse } from "next/server";
import { z } from "zod";
import { coordinatorPersonalities, coordinatorErrorCatalog } from "@commons/contracts";
import { CoordinatorTurnError } from "@commons/database";
import { readBoundedJson } from "@/lib/bounded-json";
import { CommonsMembershipRequiredError, loadCommonsSnapshot } from "@/lib/server/commons";
import { availableCapabilities } from "@/lib/server/coordinator-turn-service";
import { coordinatorErrorFrom } from "@/lib/server/coordinator-errors";
import { liveInstructions } from "@/lib/server/coordinator-live-session";
import { authenticatedCoordinatorPreferences, loadAuthenticatedCoordinatorThread } from "@/lib/server/polls";
import { readCommonsRuntimeEnvironment, coordinatorPersonalitiesEnabled } from "@/lib/server/runtime-environment";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";

export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store" };
const RequestSchema = z.object({ sdp: z.string().min(1).max(250_000), threadId: z.string().uuid().nullish() });

/** Same stable codes as the turn routes, in the `{ error: string, code }` shape the voice dialog already reads. */
function failure(error: unknown) {
  const wire = coordinatorErrorFrom(error);
  if (wire.code === "internal_error") return NextResponse.json({ error: "Voice conversation could not start. Try again.", code: wire.code }, { status: 503, headers });
  if (wire.code === "invalid_request") return NextResponse.json({ error: "The voice connection request was incomplete.", code: wire.code }, { status: 400, headers });
  if (wire.code === "auth_expired") return NextResponse.json({ error: "Sign in again to start a voice conversation.", code: wire.code }, { status: 401, headers });
  if (wire.code === "organizer_required" || wire.code === "membership_lost") return NextResponse.json({ error: "Voice conversation is available only to trip organizers.", code: wire.code }, { status: 403, headers });
  return NextResponse.json({ error: wire.userMessage, code: wire.code }, { status: coordinatorErrorCatalog[wire.code].httpStatus, headers });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) { const capabilityBlock = await agentCapabilityBlock((await params).slug); if (capabilityBlock) return capabilityBlock;
  const started = Date.now();
  try {
    const { slug } = await params;
    const snapshot = await loadCommonsSnapshot(slug);
    if (!snapshot) throw new CommonsMembershipRequiredError();
    if (snapshot.currentActor.role !== "organizer") throw new CoordinatorTurnError("organizer_required");
    const environment = readCommonsRuntimeEnvironment();
    if (environment.COMMONS_COORDINATOR_LIVE_ENABLED !== "true" || !environment.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Voice conversation is not enabled for this test.", code: "provider_not_configured" }, { status: 503, headers });
    }
    const { sdp, threadId } = RequestSchema.parse(await readBoundedJson(request, 260_000));
    // Bind the session to a thread only after the same organizer and same-trip checks every coordinator route makes.
    let threadTitle: string | null = null;
    if (threadId) {
      const payload = await loadAuthenticatedCoordinatorThread(slug, undefined, threadId);
      const active = payload.threads.find(item => item.id === threadId);
      if (!active) throw new CommonsMembershipRequiredError();
      if (active.status === "archived") return NextResponse.json({ error: coordinatorErrorCatalog.thread_archived.userMessage, code: "thread_archived" }, { status: coordinatorErrorCatalog.thread_archived.httpStatus, headers });
      threadTitle = active.title;
    }
    // Style is tone only and stays behind its own flag, like every other coordinator reply.
    let style: { name: string; instruction: string } | null = null;
    if (coordinatorPersonalitiesEnabled(environment)) {
      const preferences = await authenticatedCoordinatorPreferences(slug).catch(() => null);
      const persona = preferences ? coordinatorPersonalities.find(item => item.id === preferences.settings.personality.id) : null;
      if (persona) style = { name: persona.name, instruction: persona.instruction };
    }
    const instructions = liveInstructions({ tripName: snapshot.commons.name, threadTitle, style, capabilities: await availableCapabilities(slug) });
    // Session creation and event names follow the OpenAI GPT-Live WebRTC guide (verified in the Stage 6 log): the browser's SDP offer plus session
    // configuration are exchanged server-side, the answer goes back to the browser, and `store: false` keeps the session from being stored.
    const response = await fetch("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${environment.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          model: environment.COMMONS_COORDINATOR_LIVE_MODEL,
          instructions,
          delegation: { type: "client" },
          client: {
            data_channel: {
              allowed_client_events: ["session.commentary.append", "session.close"],
              allowed_server_events: [
                { type: "session.started" },
                { type: "session.input_transcript.delta" },
                { type: "session.output_transcript.delta" },
                { type: "session.delegation.created" },
                { type: "session.closed" },
                { type: "error" },
              ],
            },
          },
          store: false,
        },
        transport: { type: "webrtc", sdp },
      }),
      signal: request.signal,
    });
    const result = await response.json().catch(() => null) as { session?: { id?: string }; transport?: { type?: string; sdp?: string } } | null;
    if (!response.ok || !result?.session?.id || result.transport?.type !== "webrtc" || !result.transport.sdp) {
      console.warn("commons.coordinator.live_start_failed", { status: response.status, latencyMs: Date.now() - started });
      return NextResponse.json({ error: "Voice conversation could not start. Try again.", code: "provider_failed" }, { status: 503, headers });
    }
    // Content-free: the session id correlates with the client and turn events; no instructions, titles or audio are logged.
    console.info("commons.coordinator.live_started", { sessionId: result.session.id, threadBound: Boolean(threadId), capabilityCount: (await availableCapabilities(slug)).length, latencyMs: Date.now() - started });
    return NextResponse.json({ session: { id: result.session.id }, transport: { type: "webrtc", sdp: result.transport.sdp } }, { status: 201, headers });
  } catch (error) {
    return failure(error);
  }
}
