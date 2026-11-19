import { z } from "zod";
import type { AiObserver } from "./ai-observability";
import { buildPollFramingContext } from "./poll-framing-context";
import { PollInferenceError, pollAssistanceEnabled, suggestPollFraming, type PollFramingMetrics } from "./poll-inference";
import type { PollSuggestion, PollSuggestionScope } from "../poll-suggestions";

export type PollFramingOutcome = { suggestion: PollSuggestion; scope: PollSuggestionScope; model?: string };
type Reservation = Awaited<ReturnType<typeof import("@commons/database")["reservePollFraming"]>>;

export type PollFramingDependencies = {
  reserve: (slug: string, body: unknown) => Promise<Reservation>;
  complete: (slug: string, commandId: string, outcome: PollFramingOutcome | null) => Promise<void>;
  suggest: typeof suggestPollFraming;
};

async function defaultDependencies(): Promise<PollFramingDependencies> {
  const [{ reserveAuthenticatedPollInference, authenticatedPollOptions }, database] = await Promise.all([import("./polls"), import("@commons/database")]);
  return {
    reserve: reserveAuthenticatedPollInference,
    complete: async (slug, commandId, outcome) => database.completePollFraming(slug, { commandId }, outcome, await authenticatedPollOptions(slug)),
    suggest: suggestPollFraming,
  };
}

/**
 * Reserve, build the permitted packet, call the provider once, and store the sanitized result with the reservation.
 * A replayed command returns the stored result and never reaches the provider. Failure leaves the draft untouched.
 */
export async function runPollFraming(input: { slug: string; body: unknown; apiKey?: string; model?: string; telemetry?: AiObserver; metrics?: (metrics: PollFramingMetrics) => void; environment?: { [name: string]: unknown } }, dependencies?: PollFramingDependencies): Promise<PollFramingOutcome> {
  if (!pollAssistanceEnabled(input.environment) || !input.apiKey || !input.model) throw new PollInferenceError("not_configured");
  const commandId = z.object({ commandId: z.string().uuid() }).passthrough().parse(input.body).commandId;
  const deps = dependencies ?? await defaultDependencies();
  const reservation = await deps.reserve(input.slug, input.body);
  if (reservation.replay) return reservation.result as PollFramingOutcome;
  const context = buildPollFramingContext(reservation.facts, reservation.draft);
  try {
    const result = await deps.suggest({ request: reservation.request, settledFacts: reservation.settledFacts, change: reservation.change, ...context.packet },
      { apiKey: input.apiKey, model: input.model, telemetry: input.telemetry, metrics: input.metrics, environment: input.environment });
    const outcome: PollFramingOutcome = { suggestion: result.suggestion, scope: { editableQuestionIds: context.editableQuestionIds, suppliedOptionIds: context.suppliedOptionIds } };
    await deps.complete(input.slug, commandId, outcome).catch(() => undefined);
    return outcome;
  } catch (error) {
    await deps.complete(input.slug, commandId, null).catch(() => undefined);
    throw error;
  }
}
