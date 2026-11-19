/** Metadata-only instrumentation; prompts, completions, URLs and provider errors never leave Commons. */
import { TurnCapabilitySchema } from '@commons/contracts';

export type AiGeneration = {
  provider: 'openrouter' | 'openai' | 'typesafe' | 'perplexity'; model: string;
  latency: number; status?: number; failed: boolean;
  inputTokens?: number; outputTokens?: number; cost?: number;
  cachedTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number; estimatedApiCostUsd?: number;
  returnedModel?: string;
};
export type AiObserver = (generation: AiGeneration) => void;
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

// A returned identifier may be the requested alias or its dated snapshot. Do not export arbitrary provider response strings.
function returnedModelIdentifier(value: unknown, requested: string) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,119}$/.test(value)) return undefined;
  const alias = requested.replace(/^openai\//, ''), returned = value.replace(/^openai\//, '');
  return returned === alias || (returned.startsWith(`${alias}-`) && /^\d{4}-\d{2}-\d{2}$/.test(returned.slice(alias.length + 1))) ? value : undefined;
}

/** Standard API rates (Terra verified 2026-10-27; Luna verified 2026-10-14). An estimate, not a provider invoice or gateway fee. */
export function estimatedOpenAiCost(model: string, usage: { input?: number; output?: number; cached?: number; written?: number }) {
  const rates = ({ "gpt-6-luna": [0.1, 0.01, 0.125, 0.5], "gpt-4.1-mini": [0.4, 0.1, 0.4, 1.6], "gpt-6.1-sol": [2, 0.1, 2.5, 10], "gpt-6.1-terra": [1, 0.05, 1.25, 5] } as Record<string, number[]>)[model.replace(/^openai\//, "")];
  const { input, output, cached = 0, written = 0 } = usage;
  if (!rates || input === undefined || output === undefined || input > 272000 || ![input, output, cached, written].every(value => Number.isInteger(value) && value >= 0) || cached + written > input) return undefined;
  return ((input - cached - written) * rates[0] + cached * rates[1] + written * rates[2] + output * rates[3]) / 1e6;
}

/**
 * `run` receives an instrumented fetch and `reportUsage`. A JSON response's usage is read from a clone of its body; a streamed response (SSE) is never
 * read here, because that would hold the whole stream back: its reader reports the usage from the final chunk instead.
 */
export async function observeAiCall<T>(provider: AiGeneration['provider'], model: string, observer: AiObserver | undefined, run: (fetcher: typeof fetch, reportUsage: (usage: Record<string, unknown>) => void) => Promise<T>, fetcher: typeof fetch): Promise<T> {
  if (!observer) return run(fetcher, () => {});
  const started = performance.now();
  let status: number | undefined, usage: Record<string, unknown> = {}, failed = false, called = false, returnedModel: string | undefined;
  const instrumented: typeof fetch = async (...args) => {
    called = true;
    let response: Response;
    try { response = await fetcher(...args); } catch (error) { failed = true; throw error; }
    status = response.status;
    if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) return response;
    try {
      const body = await response.clone().json();
      if (body?.usage && typeof body.usage === 'object') usage = body.usage;
      returnedModel = returnedModelIdentifier(body?.model, model);
      failed ||= !response.ok || Boolean(body?.error);
    } catch { failed = true; }
    return response;
  };
  try { return await run(instrumented, reported => { usage = reported; }); }
  catch (error) { failed = true; throw error; }
  finally {
    if (called) {
      const details = (usage.prompt_tokens_details ?? usage.input_tokens_details ?? {}) as Record<string, unknown>;
      const outputDetails = (usage.completion_tokens_details ?? usage.output_tokens_details ?? {}) as Record<string, unknown>;
      const tokens = { input: finite(usage.prompt_tokens ?? usage.input_tokens), output: finite(usage.completion_tokens ?? usage.output_tokens), cached: finite(details.cached_tokens), written: finite(usage.cache_creation_input_tokens ?? usage.cache_write_input_tokens ?? details.cache_write_tokens) };
      try { observer({ provider, model, returnedModel, status, failed, latency: (performance.now() - started) / 1000,
        inputTokens: tokens.input, outputTokens: tokens.output, cachedTokens: tokens.cached, cacheWriteTokens: tokens.written, reasoningTokens: finite(outputDetails.reasoning_tokens),
        estimatedApiCostUsd: provider === 'openai' || provider === 'openrouter' ? estimatedOpenAiCost(model, tokens) : undefined,
        cost: provider === 'openrouter' ? finite(usage.cost) : undefined,
      }); } catch { /* Telemetry must never affect an application result. */ }
    }
  }
}

/** Fixed, content-free labels for one generation: which capability asked and whether it was typed or spoken. */
export type AiEventLabels = { capability?: string; inputMode?: 'text' | 'voice' };

export function aiEventProperties(generation: AiGeneration, traceId: string, sessionId: string | null, feature: string, labels: AiEventLabels = {}) {
  return {
    ...(TurnCapabilitySchema.safeParse(labels.capability).success ? { capability: labels.capability } : {}), ...(labels.inputMode === 'text' || labels.inputMode === 'voice' ? { input_mode: labels.inputMode } : {}),
    $ai_trace_id: traceId, $ai_session_id: sessionId, $ai_span_name: feature,
    $ai_model: generation.returnedModel ?? generation.model, $ai_provider: generation.provider,
    requested_model: generation.model, returned_model: generation.returnedModel,
    model_identity_coverage: generation.returnedModel ? 'reported' : 'requested_only',
    $ai_latency: generation.latency, $ai_http_status: generation.status,
    $ai_is_error: generation.failed, ...(generation.failed ? { $ai_error: 'generation_failed' } : {}),
    $ai_input_tokens: generation.inputTokens, $ai_output_tokens: generation.outputTokens,
    usage_coverage: generation.inputTokens !== undefined && generation.outputTokens !== undefined ? 'reported' : 'unknown',
    cost_coverage: generation.cost !== undefined ? 'provider_reported' : generation.estimatedApiCostUsd !== undefined ? 'estimated' : 'unknown',
    provider_charge_coverage: generation.cost !== undefined ? 'reported' : 'unknown',
    api_rate_estimate_coverage: generation.estimatedApiCostUsd !== undefined ? 'estimated' : 'unknown',
    cached_input_tokens: generation.cachedTokens, cache_write_tokens: generation.cacheWriteTokens, reasoning_tokens: generation.reasoningTokens,
    ...(generation.estimatedApiCostUsd !== undefined ? { estimated_standard_api_cost_usd: generation.estimatedApiCostUsd, cost_estimate_basis: /^(?:openai\/)?gpt-6\.1-terra$/.test(generation.model) ? 'standard-api-rates-2026-10-27' : 'standard-api-rates-2026-10-14' } : {}),
    // Gateway charges can be zero for BYOK while the upstream account is still billed. Never replace that charge with an estimate.
    ...(generation.cost !== undefined ? { provider_reported_charge_usd: generation.cost, $ai_total_cost_usd: generation.cost, $ai_cost_passthrough: true } : {}),
    feature, content_capture: 'disabled', $geoip_disable: true,
  };
}
