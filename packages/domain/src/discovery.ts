import {
  EvidenceRecordSchema, ExtractionOutputSchema, InventoryObservationSchema,
  InventoryProviderOutputSchema, InventoryRequestSchema, VerificationTraceSchema,
  type EvidenceExtractor, type EvidenceRecord, type InventoryObservation,
  type InventoryCheckSelection, type InventoryPrice, type InventoryProviderOutput, type InventoryRequest,
  type VerificationFailure, type VerificationProvider, type VerificationTrace,
} from "@commons/contracts";

export function inventoryRequestKey(raw: InventoryRequest) {
  const request = InventoryRequestSchema.parse(raw);
  return JSON.stringify({ ...request,
    party: { ...request.party, participantIds: [...request.party.participantIds].sort(),
      childAges: request.party.childAges?.slice().sort((a, b) => (a ?? -1) - (b ?? -1)) ?? null },
    essentialComponents: [...request.essentialComponents].sort(),
    dependencies: [...request.dependencies].sort((a, b) => a.componentId.localeCompare(b.componentId)),
  });
}

export function inventoryPriceCompleteness(price: InventoryPrice) {
  if (price.amount === null || price.currency === null || price.basis === "unknown") return "unknown" as const;
  return price.basis === "total" && price.taxes === "included" && price.fees === "included"
    && price.coversAllRequestedComponents === true ? "complete_total" as const : "partial" as const;
}

export function assessInventoryObservation(raw: InventoryObservation, current: InventoryRequest, now = new Date(), selection?: InventoryCheckSelection) {
  const observation = InventoryObservationSchema.parse(raw);
  const { request, output, trace } = observation;
  const reasons: string[] = [];
  if (inventoryRequestKey(request) !== inventoryRequestKey(current)) reasons.push("input_changed");
  if (request.dependencies.some(item => !current.dependencies.some(value => value.componentId === item.componentId && value.version === item.version))) reasons.push("dependency_changed");
  if (inventoryRequestKey(request) !== inventoryRequestKey(output.checkedRequest)) reasons.push("checked_request_mismatch");
  // No invented freshness window: a missing expiry is explicitly unknown.
  if (!output.validUntil) reasons.push("freshness_unknown");
  else if (Date.parse(output.validUntil) <= now.getTime()) reasons.push("stale");
  if (Date.parse(output.checkedAt) > now.getTime()) reasons.push("future_check");
  if (selection && now.getTime() - Date.parse(output.checkedAt) > selection.maxAgeMs) reasons.push("stale_for_purpose");
  const { party } = request;
  if (!request.provider || !request.startsOn || !request.endsOn || !request.timezone || !request.duration
    || party.adults === null || party.childAges === null || party.childAges.includes(null) || party.units === null
    || (request.target.kind !== "property" && !request.startLocalTime)) reasons.push("incomplete_request");
  const count = party.adults !== null && party.childAges !== null ? party.adults + party.childAges.length : null;
  if (!count || count !== party.participantIds.length) reasons.push("party_coverage_unknown");
  const nights = request.startsOn && request.endsOn
    ? (Date.parse(request.endsOn) - Date.parse(request.startsOn)) / 86_400_000 : null;
  if (request.target.kind === "property" && nights !== null && (nights <= 0
    || request.duration?.unit !== "nights" || request.duration.amount !== nights)) reasons.push("duration_mismatch");
  if (output.restrictions.minimumNights && nights !== null && nights < output.restrictions.minimumNights) reasons.push("minimum_stay_mismatch");
  if (output.restrictions.maximumParty && count !== null && count > output.restrictions.maximumParty) reasons.push("party_size_mismatch");
  if (output.restrictions.minimumAge !== null) {
    if (party.childAges?.some(age => age !== null && age < output.restrictions.minimumAge!)) reasons.push("age_mismatch");
    if (output.restrictions.minimumAge > 18 && party.adults) reasons.push("adult_ages_unknown");
  }
  const evidenceQuality = trace.mode === "fixture" ? "fixture" as const
    : trace.mode === "direct_inventory" && output.capture.kind === "inventory_response"
      ? "direct_observation" as const : "unverified" as const;
  return {
    applicability: reasons.length ? "not_applicable" as const : "applicable" as const,
    reasons, availability: output.availability, bookingMechanism: output.bookingMechanism,
    priceCompleteness: inventoryPriceCompleteness(output.price), evidenceQuality,
    availableAsObserved: reasons.length === 0 && evidenceQuality === "direct_observation"
      && output.availability === "available",
    reservation: false as const,
  };
}

// Compare only caller-authorized observations. Preserve all sources; never silently pick a winner.
export function findInventoryConflicts(observations: InventoryObservation[]) {
  const conflicts: Array<{ first: number; second: number; fields: string[] }> = [];
  observations.forEach((first, i) => observations.slice(i + 1).forEach((second, offset) => {
    if (inventoryRequestKey(first.request) !== inventoryRequestKey(second.request)) return;
    const fields: string[] = [];
    if (first.output.availability !== second.output.availability) fields.push("availability");
    if (JSON.stringify(first.output.price) !== JSON.stringify(second.output.price)) fields.push("price");
    if (JSON.stringify(first.output.restrictions) !== JSON.stringify(second.output.restrictions)) fields.push("restrictions");
    if (fields.length) conflicts.push({ first: i, second: i + offset + 1, fields });
  }));
  return conflicts;
}

export type VerificationAttemptResult = {
  errorCode: VerificationFailure | null;
  trace: VerificationTrace;
  observation: InventoryObservation | null;
  // A valid original provider response survives failed extraction and is never overwritten on retry.
  providerOutput: InventoryProviderOutput | null;
  modelResponse: string | null;
};

class VerificationError extends Error {
  constructor(readonly code: VerificationFailure) { super(code); }
}
async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, code: VerificationFailure) {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(abort.signal)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new VerificationError(code)); }, timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function verifyInventoryEvidence(input: {
  evidence: EvidenceRecord; request: InventoryRequest; provider: VerificationProvider;
  extractor?: EvidenceExtractor; timeoutMs?: number; now?: () => Date;
}): Promise<VerificationAttemptResult> {
  const evidence = EvidenceRecordSchema.parse(input.evidence);
  const request = InventoryRequestSchema.parse(input.request);
  const clock = input.now ?? (() => new Date());
  const startedAt = clock().toISOString();
  const timeout = Math.min(30_000, Math.max(1, input.timeoutMs ?? 10_000));
  let providerOutput: InventoryProviderOutput | null = null;
  let modelResponse: string | null = null;
  let stage: "provider" | "model" = "provider";
  const trace = () => VerificationTraceSchema.parse({
    providerId: input.provider.id, providerVersion: input.provider.version, mode: input.provider.mode,
    model: input.extractor ? { providerId: input.extractor.providerId, modelId: input.extractor.modelId, version: input.extractor.version } : null,
    startedAt, finishedAt: clock().toISOString(),
  });
  // Validate server configuration before starting an adapter, not only after it fails.
  trace();
  try {
    const raw = await bounded(signal => input.provider.verify({ request: structuredClone(request), evidence: structuredClone(evidence), signal }), timeout, "provider_timeout");
    const parsed = InventoryProviderOutputSchema.safeParse(raw);
    if (!parsed.success) throw new VerificationError("malformed_provider_output");
    providerOutput = parsed.data;
    if (Date.parse(providerOutput.checkedAt) > clock().getTime()) throw new VerificationError("malformed_provider_output");
    let extraction = null;
    if (input.extractor) {
      stage = "model";
      const rawExtraction = await bounded(signal => input.extractor!.extract({ untrustedText: providerOutput!.capture.originalText, signal }), timeout, "model_timeout");
      modelResponse = JSON.stringify(rawExtraction) ?? null;
      if (modelResponse && modelResponse.length > 64_000) { modelResponse = modelResponse.slice(0, 64_000); throw new VerificationError("malformed_model_output"); }
      const parsedExtraction = ExtractionOutputSchema.safeParse(rawExtraction);
      if (!parsedExtraction.success || parsedExtraction.data.claims.some(claim => !providerOutput!.capture.originalText.includes(claim.quote))) throw new VerificationError("malformed_model_output");
      extraction = parsedExtraction.data;
    }
    const runTrace = trace();
    const observation = InventoryObservationSchema.parse({ evidenceId: evidence.id, request,
      output: providerOutput, trace: runTrace, extraction, extractionKind: "model_inference", approval: "not_requested" });
    return { errorCode: null, trace: runTrace, observation, providerOutput, modelResponse };
  } catch (error) {
    return { errorCode: error instanceof VerificationError ? error.code : stage === "provider" ? "provider_failed" : "model_failed",
      trace: trace(), observation: null, providerOutput, modelResponse };
  }
}
