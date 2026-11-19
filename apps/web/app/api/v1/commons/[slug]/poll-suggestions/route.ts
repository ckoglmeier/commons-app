import { posthogAiObserver } from '@/lib/server/posthog-ai';
import { NextResponse } from "next/server";
import { CommandAccessError, CommandConflictError, PollFramingInFlightError, PollInferenceLimitError } from "@commons/database";
import { ZodError } from "zod";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons";
import { readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";
import { PollInferenceError, pollAssistanceEnabled } from "@/lib/server/poll-inference";
import { runPollFraming } from "@/lib/server/poll-framing-service";
import { readBoundedJson } from "@/lib/bounded-json";
import { recordOperationFailure } from "@/lib/server/outcome-telemetry";

export const maxDuration = 60;
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const { slug } = await params;
    const environment = readCommonsRuntimeEnvironment();
    if (!pollAssistanceEnabled() || !environment.OPENAI_API_KEY || !environment.COMMONS_POLL_MODEL) throw new PollInferenceError("not_configured");
    const body = await readBoundedJson(request);
    const posthog = await posthogAiObserver(request, 'poll_suggestions');
    // PostHog gets $ai_generation when it is configured and allowed.
    const telemetry = (generation: Parameters<NonNullable<typeof posthog>>[0]) => { posthog?.(generation); };
    // Sizes and latency only. Prompt and output text are never logged.
    const result = await runPollFraming({ slug, body, apiKey: environment.OPENAI_API_KEY, model: environment.COMMONS_POLL_MODEL, telemetry,
      metrics: metrics => console.info("commons.poll_assist", metrics) });
    return NextResponse.json(result, { headers });
  } catch (error) {
    const status = error instanceof CommonsAuthenticationRequiredError ? 401
      : error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError ? 403
      : error instanceof PollInferenceLimitError ? 429
      : error instanceof CommandConflictError || error instanceof PollFramingInFlightError ? 409
      : error instanceof ZodError || error instanceof SyntaxError ? 400
      : 503;
    const message = error instanceof PollInferenceError || error instanceof PollInferenceLimitError || error instanceof PollFramingInFlightError ? error.message
      : status === 409 ? "Your draft changed after this request. Ask again to use fresh help."
      : status === 403 ? "Only a trip organizer can ask for writing help."
      : status === 401 ? "Sign in again before asking for writing help."
      : status === 400 ? "Describe what needs deciding and save the draft first."
      : "Writing help isn’t available right now. Your draft is unchanged.";
    if (status === 429 || status === 503) recordOperationFailure({ operation: "poll_assist", error, trip: (await params).slug, request });
    return NextResponse.json({ error: message, code: error instanceof PollInferenceError ? error.code : undefined }, { status, headers });
  }
}
