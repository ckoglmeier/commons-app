import { randomUUID } from "node:crypto";
import {
  ResearchDecisionBriefSchema, ResearchDecisionCheckpointSchema,
  type DecisionSource, type ResearchDecisionBrief, type ResearchDecisionCheckpoint, type ResearchDecisionComparison,
} from "@commons/contracts";
import { compareResearchDecision, normalizeDecisionExtraction } from "@commons/domain";
import { publicResearchUrl, researchForCoordinator, type ResearchProvider } from "./coordinator-research";
import { RESEARCH_DECISION_EXTRACTION_LIMITS } from "./research-decision-extraction";

/** Domain handler only. The shared coordinator owns auth, Trip Brain, leases, scheduling and storage. */
export type DecisionInvocation = { taskId: string; actorId: string; leaseToken: string };
export type DecisionAssignment = {
  brief: ResearchDecisionBrief;
  checkpoint: ResearchDecisionCheckpoint | null;
  comparison: ResearchDecisionComparison | null;
  /** Shared artifact identity. The standalone fixture port may omit this. */
  comparisonId?: string;
  mode: "fixture" | "public_reference";
  maxCalls: number;
  deadlineAt: number;
  policyVersion: string;
};
export interface ResearchDecisionStore {
  /** Load only an active organizer's permitted context, with the current task/thread/lease. */
  load(invocation: DecisionInvocation): Promise<DecisionAssignment>;
  /** Recheck auth, membership, versions and lease immediately before an external call. */
  isCurrent(invocation: DecisionInvocation, brief: ResearchDecisionBrief): Promise<boolean>;
  /** Atomic CAS, including comparison revision; reservations survive crashes and failed calls. */
  commit(invocation: DecisionInvocation, expected: {
    briefRevision: number; contextRevision: string; checkpointRevision: number | null; comparisonRevision: number | null;
  }, update: { checkpoint: ResearchDecisionCheckpoint; comparison?: ResearchDecisionComparison }): Promise<boolean>;
  /** Re-run the shared public-query privacy check. Null means do not search, NOT guess another query. */
  publicQuery(invocation: DecisionInvocation, query: string): Promise<string | null>;
}
export interface DecisionExtractor {
  name: string;
  /** Required for non-fixture work; pinned by the shared runtime, never picked by the domain. */
  policyVersion?: string;
  // No raw thread, traveler names, private notes, actor IDs or payment/booking capabilities.
  extract(input: {
    kind: ResearchDecisionBrief["kind"]; partySize: number;
    nominated: ResearchDecisionBrief["nominated"]; legs: ResearchDecisionBrief["legs"];
    sources: DecisionSource[];
  }, options: { signal: AbortSignal }): Promise<unknown>;
}
export type DecisionTrace = {
  phase: "search" | "read" | "extract" | "compare";
  outcome: "started" | "completed" | "failed";
  taskId: string; recipeKey: string; recipeVersion: number; policyVersion: string;
  callsUsed: number; sourceCount: number; mode: DecisionAssignment["mode"];
};
export type DecisionStepOutcome = {
  state: "checkpointed" | "comparison_ready" | "cancelled" | "stale";
  checkpoint: ResearchDecisionCheckpoint | null;
  comparison: ResearchDecisionComparison | null;
};
class StaleDecision extends Error {}
const unique = (items: string[]) => [...new Set(items)].slice(0, 20);

function matches(brief: ResearchDecisionBrief, checkpoint: ResearchDecisionCheckpoint) {
  return checkpoint.taskId === brief.taskId && checkpoint.briefRevision === brief.revision
    && checkpoint.contextRevision === brief.contextRevision && checkpoint.recipeKey === brief.recipe.key
    && checkpoint.recipeVersion === brief.recipe.version && checkpoint.queryIndex <= brief.queries.length
    && checkpoint.extractedSourceCount <= checkpoint.sources.length;
}
function initialCheckpoint(brief: ResearchDecisionBrief, policyVersion: string): ResearchDecisionCheckpoint {
  return { schemaVersion: 1, revision: 1, taskId: brief.taskId, briefRevision: brief.revision,
    contextRevision: brief.contextRevision, recipeKey: brief.recipe.key, recipeVersion: brief.recipe.version, policyVersion,
    phase: "search", queryIndex: 0, extractedSourceCount: 0, callsUsed: 0, sources: [],
    extraction: { findings: [], components: [], packages: [] }, limitations: [] };
}
async function bounded<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    // Always attach rejection handlers, even if the adapter ignores cancellation.
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** One bounded recipe step. It is not a parallel task queue or an alternate coordinator loop. */
export async function runResearchDecisionStep(invocation: DecisionInvocation, deps: {
  store: ResearchDecisionStore; provider: ResearchProvider; providerName: string; extractor: DecisionExtractor;
  signal?: AbortSignal; trace?: (event: DecisionTrace) => void;
}): Promise<DecisionStepOutcome> {
  deps.signal?.throwIfAborted();
  const assignment = await deps.store.load(invocation);
  const brief = ResearchDecisionBriefSchema.parse(assignment.brief);
  if (brief.taskId !== invocation.taskId || brief.ownerId !== invocation.actorId) throw new Error("Assignment is outside the organizer's scope.");
  if (!Number.isInteger(assignment.maxCalls) || assignment.maxCalls < 0 || assignment.maxCalls > 20
    || !Number.isFinite(assignment.deadlineAt) || !assignment.policyVersion) throw new Error("Missing bounded execution policy.");
  if (assignment.mode === "public_reference" && deps.extractor.policyVersion !== assignment.policyVersion) throw new Error("The extractor does not match the pinned shared model policy.");
  if (brief.recipe.version !== 1 || brief.recipe.key !== `${brief.kind}-decision-v1`) throw new Error("Unsupported domain recipe.");
  let checkpoint = assignment.checkpoint ? ResearchDecisionCheckpointSchema.parse(assignment.checkpoint) : null;
  const unchanged = () => ({ state: "stale" as const, checkpoint, comparison: assignment.comparison });
  if (checkpoint && (!matches(brief, checkpoint) || checkpoint.policyVersion !== assignment.policyVersion) || !await deps.store.isCurrent(invocation, brief)) return unchanged();
  if (!checkpoint) {
    const initial = initialCheckpoint(brief, assignment.policyVersion);
    if (!await deps.store.commit(invocation, { briefRevision: brief.revision, contextRevision: brief.contextRevision,
      checkpointRevision: null, comparisonRevision: assignment.comparison?.revision ?? null }, { checkpoint: initial })) return unchanged();
    checkpoint = initial;
  }
  let current: ResearchDecisionCheckpoint = checkpoint;
  const trace = (phase: DecisionTrace["phase"], outcome: DecisionTrace["outcome"]) => {
    // Observability must not break a comparison, and contains no queries/quotes/leg labels.
    try { deps.trace?.({ phase, outcome, taskId: brief.taskId, recipeKey: brief.recipe.key, recipeVersion: brief.recipe.version,
      policyVersion: assignment.policyVersion, callsUsed: current.callsUsed, sourceCount: current.sources.length, mode: assignment.mode }); } catch { /* optional observer */ }
  };
  const save = async (patch: Partial<ResearchDecisionCheckpoint>, comparison?: ResearchDecisionComparison) => {
    const next = ResearchDecisionCheckpointSchema.parse({ ...current, ...patch, revision: current.revision + 1 });
    if (!await deps.store.commit(invocation, { briefRevision: brief.revision, contextRevision: brief.contextRevision,
      checkpointRevision: current.revision, comparisonRevision: assignment.comparison?.revision ?? null }, { checkpoint: next, comparison })) throw new StaleDecision();
    current = next;
  };
  const reserve = async () => {
    deps.signal?.throwIfAborted();
    if (current.callsUsed >= assignment.maxCalls || Date.now() >= assignment.deadlineAt) throw new Error("Research budget exhausted.");
    await save({ callsUsed: current.callsUsed + 1 });
    if (!await deps.store.isCurrent(invocation, brief)) throw new StaleDecision();
  };
  const result = (comparison: ResearchDecisionComparison | null = assignment.comparison): DecisionStepOutcome => ({
    state: current.phase === "done" ? "comparison_ready" : "checkpointed", checkpoint: current, comparison,
  });
  try {
    if (current.phase === "done") return result();
    if (Date.now() >= assignment.deadlineAt || current.callsUsed >= assignment.maxCalls) {
      await save({ phase: "compare", limitations: unique([...current.limitations, "The execution budget ended; remaining evidence is unverified."]) });
    }
    if (current.phase === "search") {
      const query = brief.queries[current.queryIndex];
      if (!query) { await save({ phase: current.sources.length > current.extractedSourceCount ? "extract" : "compare" }); return result(); }
      if (query.followUpFor && current.sources.length > current.extractedSourceCount) { await save({ phase: "extract" }); return result(); }
      if (query.followUpFor) {
        const rows = current.extraction.findings.filter(f => f.candidateId === query.followUpFor);
        // Follow up only on missing/conflicting critical group capacity/access, not automatic exploration.
        const experiences = new Set(rows.map(f => f.experience ? `${f.experience.id}:${f.experience.name}` : "legacy-fixture"));
        const complete = experiences.size === 1 && ["maximumParty", "membersOnly"].every(field => new Set(rows.filter(f => f.field === field).map(f => JSON.stringify(f.value))).size === 1);
        if (complete) { await save({ queryIndex: current.queryIndex + 1 }); return result(); }
      }
      const approved = await deps.store.publicQuery(invocation, query.text);
      if (!approved || approved !== query.text) {
        await save({ queryIndex: current.queryIndex + 1, limitations: unique([...current.limitations, "A public query needs organizer review after the privacy check; it was not sent."]) }); return result();
      }
      const runId = randomUUID();
      const provider: ResearchProvider = {
        search: async (text, options) => { await reserve(); options.signal.throwIfAborted(); trace("search", "started");
          try { const rows = await deps.provider.search(text, options); trace("search", "completed"); return rows; }
          catch (error) { trace("search", "failed"); throw error; } },
        read: async (urls, options) => { await reserve(); options.signal.throwIfAborted(); trace("read", "started");
          try { const rows = await deps.provider.read(urls, options); trace("read", "completed"); return rows; }
          catch (error) { trace("read", "failed"); throw error; } },
      };
      // Its internal read deadline returns captured snippets; parent cancellation still discards the turn.
      const researched = await researchForCoordinator(approved, provider, deps.signal, Math.max(1, Math.min(20_000, assignment.deadlineAt - Date.now())));
      const sources: DecisionSource[] = researched.sources.filter(s => publicResearchUrl(s.url)).map(s => ({ runId, sourceId: s.id,
        url: s.url, title: s.title, excerpt: s.excerpt, retrievedAt: s.retrievedAt, coverage: s.coverage, provider: deps.providerName }));
      await save({ queryIndex: current.queryIndex + 1, sources: [...current.sources, ...sources].slice(0, 60), limitations: unique([...current.limitations, ...researched.limitations]) });
      return result();
    }
    if (current.phase === "extract") {
      const batch = current.sources.slice(current.extractedSourceCount, current.extractedSourceCount + RESEARCH_DECISION_EXTRACTION_LIMITS.sourcesPerCall);
      if (!batch.length) { await save({ phase: current.queryIndex < brief.queries.length ? "search" : "compare" }); return result(); }
      await reserve(); trace("extract", "started");
      const signal = AbortSignal.any([...(deps.signal ? [deps.signal] : []), AbortSignal.timeout(Math.max(1, Math.min(20_000, assignment.deadlineAt - Date.now())))]);
      let raw: unknown;
      try {
        raw = await bounded(() => deps.extractor.extract({ kind: brief.kind, partySize: brief.partySize, nominated: brief.nominated,
          legs: brief.legs, sources: batch }, { signal }), signal);
        trace("extract", "completed");
      } catch (error) {
        trace("extract", "failed"); deps.signal?.throwIfAborted();
        if (error instanceof StaleDecision) throw error;
        await save({ phase: "compare", limitations: unique([...current.limitations, "Extraction stopped; unextracted evidence is retained for review."]) }); return result();
      }
      const normalized = normalizeDecisionExtraction(brief, batch, raw, { requireWineryExperience: assignment.mode !== "fixture" });
      const combined = normalizeDecisionExtraction(brief, current.sources, {
        findings: [...current.extraction.findings, ...normalized.extraction.findings],
        components: [...current.extraction.components, ...normalized.extraction.components], packages: [...current.extraction.packages, ...normalized.extraction.packages],
      }, { requireWineryExperience: assignment.mode !== "fixture" });
      const extractedSourceCount = current.extractedSourceCount + batch.length;
      await save({ extraction: combined.extraction, extractedSourceCount,
        phase: extractedSourceCount < current.sources.length ? "extract" : current.queryIndex < brief.queries.length ? "search" : "compare",
        limitations: unique([...current.limitations, ...normalized.limitations, ...combined.limitations]) });
      return result();
    }
    if (current.phase === "compare") {
      trace("compare", "started");
      const comparison = compareResearchDecision({ brief, sources: current.sources, extraction: current.extraction, comparisonId: assignment.comparisonId ?? randomUUID(),
        previous: assignment.comparison, limitations: current.limitations, mode: assignment.mode });
      await save({ phase: "done" }, comparison); trace("compare", "completed"); return result(comparison);
    }
    return result();
  } catch (error) {
    if (error instanceof StaleDecision) return { state: "stale", checkpoint: current, comparison: assignment.comparison };
    if (deps.signal?.aborted) return { state: "cancelled", checkpoint: current, comparison: assignment.comparison };
    // Timeout/provider failures do not retry or erase prior evidence.
    try { await save({ phase: "compare", limitations: unique([...current.limitations, "The step stopped; unresolved evidence is unverified."]) }); }
    catch (saveError) { if (saveError instanceof StaleDecision) return { state: "stale", checkpoint: current, comparison: assignment.comparison }; throw saveError; }
    return result();
  }
}
