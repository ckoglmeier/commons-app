import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { CoordinatorErrorCodeSchema, ModelTierSchema, TurnCapabilitySchema } from '@commons/contracts';
import { aiEventProperties, type AiEventLabels, type AiGeneration } from './ai-observability';
import { inferenceScopes as scopes, currentInferenceTrace } from './inference-trace-context';
export { currentInferenceTrace, inferenceObserver } from './inference-trace-context';

/** Code-owned steps only. Neither recipes nor model output can add analytics fields or span names. */
export const inferenceStages = ['auth', 'reserve', 'context', 'dispatch', 'routing', 'handler', 'model', 'research', 'validation', 'commit', 'failure_commit', 'delivery'] as const;
export type InferenceStage = typeof inferenceStages[number];
export type TraceStatus = 'completed' | 'failed' | 'cancelled' | 'pending' | 'replayed';
export type TraceMetadata = {
  capability?: string; modelTier?: string; inputMode?: 'text' | 'voice';
  outcome?: string;
  errorCode?: string; contextChars?: number; contextTruncated?: boolean; sourceCount?: number; artifactCount?: number;
  firstTextMs?: number | null; reviewRequired?: boolean; policyVersion?: string | number; codeRevision?: string;
  routeReason?: 'explicit_action' | 'deterministic_intent' | 'construction' | 'extraction' | 'advisory' | 'configured_router';
  workflowPurpose?: 'trip_feasibility' | 'attendance_confirmation' | 'lodging_selection' | 'general_poll' | 'itinerary';
  workflowVersion?: number; workflowDigest?: string;
};
export type InferenceEvent = { uuid: string; event: '$ai_span' | '$ai_generation'; timestamp: string; properties: Record<string, unknown> };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const id = () => randomBytes(8).toString('hex');
const uuid = (hash: string) => `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9 ? value : undefined;
const traceStatuses: TraceStatus[] = ['completed', 'failed', 'cancelled', 'pending', 'replayed'];

/** Runtime allowlist: spreading an object that happens to satisfy a TS type is NOT safe enough. */
export function traceMetadata(metadata: TraceMetadata): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ['contextChars', 'sourceCount', 'artifactCount', 'firstTextMs', 'workflowVersion'] as const) {
    if (count(metadata[key]) !== undefined) result[key] = metadata[key];
  }
  for (const key of ['contextTruncated', 'reviewRequired'] as const) if (typeof metadata[key] === 'boolean') result[key] = metadata[key];
  if (TurnCapabilitySchema.safeParse(metadata.capability).success) result.capability = metadata.capability;
  if (ModelTierSchema.safeParse(metadata.modelTier).success) result.modelTier = metadata.modelTier;
  if (CoordinatorErrorCodeSchema.safeParse(metadata.errorCode).success) result.errorCode = metadata.errorCode;
  if (metadata.inputMode === 'text' || metadata.inputMode === 'voice') result.inputMode = metadata.inputMode;
  const choices = {
    outcome: ['answered', 'proposal', 'evidence', 'clarification', 'direct_change', 'unsupported', 'steering', 'navigation', 'answered_with_limit_notice', 'failed', 'stopped', 'pending'],
    routeReason: ['explicit_action', 'deterministic_intent', 'construction', 'extraction', 'advisory', 'configured_router'],
    workflowPurpose: ['trip_feasibility', 'attendance_confirmation', 'lodging_selection', 'general_poll', 'itinerary'],
  };
  for (const key of ['outcome', 'routeReason', 'workflowPurpose'] as const) if (metadata[key] && choices[key].includes(metadata[key]!)) result[key] = metadata[key];
  if (typeof metadata.policyVersion === 'number' && count(metadata.policyVersion) !== undefined) result.policyVersion = metadata.policyVersion;
  if (typeof metadata.policyVersion === 'string' && /^v?[0-9][0-9a-z.-]{0,39}$/.test(metadata.policyVersion)) result.policyVersion = metadata.policyVersion;
  if (metadata.codeRevision && /^[a-f0-9]{7,40}$/.test(metadata.codeRevision)) result.codeRevision = metadata.codeRevision;
  if (metadata.workflowDigest && /^[a-f0-9]{64}$/.test(metadata.workflowDigest)) result.workflowDigest = metadata.workflowDigest;
  return result;
}

/** Trusted server IDs only. No inbound traceparent, prompt, slug, or user-chosen label is accepted. */
export function inferenceCorrelation(input: { tripId: string; actorId: string; commandId: string; threadId: string; attempt: number }) {
  const validId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (![input.tripId, input.actorId, input.commandId, input.threadId].every(value => validId.test(value)) || !Number.isSafeInteger(input.attempt) || input.attempt < 1) throw new Error('invalid_trace_scope');
  const traceId = digest(`commons.inference.v1:${input.tripId}:${input.actorId}:${input.commandId}`).slice(0, 32);
  return { traceId, sessionId: digest(`commons.session.v1:${input.tripId}:${input.actorId}:${input.threadId}`),
    attemptId: digest(`${traceId}:attempt:${input.attempt}`).slice(0, 16), attempt: input.attempt };
}

/** Request-local bounded collector, not a durable queue or a source of authorization. */
export class InferenceTrace {
  readonly correlation: ReturnType<typeof inferenceCorrelation>;
  private events: InferenceEvent[] = [];
  private active = new Set<string>();
  private sequence: InferenceStage[] = [];
  private dropped = 0;
  private finished = false;
  private generations = 0;
  private measuredUsage = 0;
  private measuredCost = 0;
  private providerCharges = 0;
  private estimatedCosts = 0;
  private readonly eventLimit: number;
  private metadata: Record<string, unknown> = {};
  constructor(input: Parameters<typeof inferenceCorrelation>[0], private options: {
    startedAt?: number; now?: () => number; synthetic?: boolean; replay?: boolean; maxEvents?: number;
    onFinish?: (events: InferenceEvent[]) => void;
  } = {}) {
    this.correlation = { ...inferenceCorrelation(input), ...(options.replay ? { attemptId: id() } : {}) };
    this.eventLimit = Number.isSafeInteger(options.maxEvents) && options.maxEvents! > 0 ? Math.min(128, options.maxEvents!) : 64;
  }
  private now() { return this.options.now?.() ?? Date.now(); }
  private common() {
    return { $ai_trace_id: this.correlation.traceId, $ai_session_id: this.correlation.sessionId, attempt: this.correlation.attempt,
      trace_schema_version: 1, privacy_policy_version: 1, content_capture: 'disabled', $geoip_disable: true,
      workload: this.options.synthetic ? 'synthetic' : 'live', execution_kind: this.options.replay ? 'receipt_read' : 'attempt', feature: 'workspace', ...this.metadata };
  }
  set(metadata: TraceMetadata) { if (!this.finished) Object.assign(this.metadata, traceMetadata(metadata)); }
  private append(event: InferenceEvent) {
    if (this.finished) { this.dropped++; return; }
    // Reserve the final slot for the attempt summary, including the dropped-event counter.
    if (this.events.length >= this.eventLimit - 1) { this.dropped++; return; }
    this.events.push(event);
  }
  run<T>(run: () => T): T { return scopes.run({ trace: this, parentId: this.correlation.attemptId }, run); }
  begin(stage: InferenceStage, metadata: TraceMetadata = {}, startedAt = this.now()) {
    if (!inferenceStages.includes(stage)) throw new Error('invalid_trace_stage');
    const spanId = id(), parentId = scopes.getStore()?.trace === this ? scopes.getStore()!.parentId : this.correlation.attemptId;
    let ended = false;
    this.active.add(spanId);
    if (this.sequence.length < 64) this.sequence.push(stage);
    return {
      run: <T>(run: () => T): T => scopes.run({ trace: this, parentId: spanId }, run),
      finish: (status: TraceStatus = 'completed', extra: TraceMetadata = {}, endedAt = this.now()) => {
        if (ended) return;
        ended = true; this.active.delete(spanId);
        if (!traceStatuses.includes(status)) status = 'failed';
        this.append({ uuid: randomUUID(), event: '$ai_span', timestamp: new Date(startedAt).toISOString(), properties: {
          ...this.common(), ...traceMetadata(metadata), ...traceMetadata(extra), $ai_span_id: spanId, $ai_parent_id: parentId,
          $ai_span_name: `coordinator.${stage}`, $ai_latency: Math.max(0, endedAt - startedAt) / 1000,
          $ai_is_error: status === 'failed', span_status: status, ...(status === 'failed' ? { $ai_error: traceMetadata(extra).errorCode ?? 'step_failed' } : {}),
        } });
      },
    };
  }
  generation(generation: AiGeneration, labels: AiEventLabels = {}) {
    this.generations++;
    if (generation.inputTokens !== undefined && generation.outputTokens !== undefined) this.measuredUsage++;
    if (generation.cost !== undefined || generation.estimatedApiCostUsd !== undefined) this.measuredCost++;
    if (generation.cost !== undefined) this.providerCharges++;
    if (generation.estimatedApiCostUsd !== undefined) this.estimatedCosts++;
    const spanId = id(), scope = scopes.getStore(), endedAt = this.now();
    this.append({ uuid: randomUUID(), event: '$ai_generation', timestamp: new Date(endedAt - generation.latency * 1000).toISOString(), properties: {
      ...this.common(), ...aiEventProperties(generation, this.correlation.traceId, this.correlation.sessionId, 'workspace', labels),
      $ai_span_id: spanId, $ai_parent_id: scope?.trace === this ? scope.parentId : this.correlation.attemptId,
    } });
  }
  finish(status: TraceStatus, metadata: TraceMetadata = {}) {
    if (this.finished) return;
    this.set(metadata);
    if (!traceStatuses.includes(status)) status = 'failed';
    const endedAt = this.now(), startedAt = this.options.startedAt ?? endedAt;
    this.events.push({ uuid: uuid(digest(`${this.correlation.traceId}:${this.correlation.attemptId}:summary`)), event: '$ai_span', timestamp: new Date(startedAt).toISOString(), properties: {
      // PostHog groups these root spans into a pseudo-trace by trace ID; no fabricated parent span is emitted.
      ...this.common(), $ai_span_id: this.correlation.attemptId,
      $ai_span_name: this.options.replay ? 'coordinator.replay' : 'coordinator.attempt', $ai_latency: Math.max(0, endedAt - startedAt) / 1000, span_status: status,
      $ai_is_error: status === 'failed', ...(status === 'failed' ? { $ai_error: this.metadata.errorCode ?? 'turn_failed' } : {}),
      trace_scope: 'attempt', trace_complete: this.dropped === 0 && this.active.size === 0 && status !== 'pending',
      dropped_event_count: this.dropped, unfinished_span_count: this.active.size,
      generation_count: this.generations, measured_usage_count: this.measuredUsage, measured_cost_count: this.measuredCost,
      provider_charge_count: this.providerCharges, api_rate_estimate_count: this.estimatedCosts,
      step_signature: this.sequence.join('>'), export_delivery: 'unconfirmed',
    } });
    this.finished = true;
    try { this.options.onFinish?.(this.snapshot()); } catch { /* Analytics is not execution state. */ }
  }
  snapshot(): InferenceEvent[] { return structuredClone(this.events); }
}

export async function withInferenceSpan<F extends () => Promise<unknown>>(stage: InferenceStage, run: F, metadata: TraceMetadata = {}): Promise<Awaited<ReturnType<F>>> {
  const trace = currentInferenceTrace();
  if (!trace) return await run() as Awaited<ReturnType<F>>;
  const span = trace.begin(stage, metadata);
  try { const result = await span.run(run); span.finish(); return result as Awaited<ReturnType<F>>; }
  catch (error) { span.finish('failed'); throw error; }
}
