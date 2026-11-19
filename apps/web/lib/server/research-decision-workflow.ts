import { createHash } from "node:crypto";
import { ResearchDecisionCheckpointSchema, ResearchDecisionComparisonSchema, type WorkflowExecution } from "@commons/contracts";
import type { WorkflowHandlerContract, WorkflowWorkerHandler } from "@commons/database";
import { researchDecisionRepository, validResearchDecisionInput, validResearchDecisionCheckpoint, validResearchDecisionComparison,
  ResearchDecisionInputSchema } from "./research-decision-repository";
import { runResearchDecisionStep, type DecisionExtractor, type DecisionTrace } from "./research-decision-specialist";
import { publicResearchUrl, type ResearchProvider } from "./coordinator-research";
import { validSavedResearchDecisionContext } from "./research-decision-input";

export const RESEARCH_DECISION_RECIPES = ["winery", "transport"].map(kind => ({
  key: `${kind}-decision-v1`, version: 1,
  digest: createHash("sha256").update(JSON.stringify({ kind, version: 1, stages: ["search", "extract", "compare"],
    sourcesPerExtraction: 5, evidence: "captured-reference-v1", completion: "usable-evidence-v2", wineryScope: kind === "winery" ? "experience-v3-explicit-capacity" : null,
    ...(kind === "transport" ? { transportAttendance: "exact-current-full-window-v1", transportAnswers: "reviewed-per-leg-drivers-and-luggage-v1" } : {}),
    savedInput: "source-seal-v2" })).digest("hex"),
}));

function completion(execution: WorkflowExecution) {
  const comparison = ResearchDecisionComparisonSchema.parse(execution.comparison?.value);
  const checkpoint = ResearchDecisionCheckpointSchema.parse(execution.checkpoint?.value);
  const { plan } = ResearchDecisionInputSchema.parse(execution.input);
  if (checkpoint.phase !== "done" || comparison.id !== execution.artifact.id || comparison.kind !== plan.kind
    || comparison.contextRevision !== execution.pins.contextVersion || comparison.briefRevision !== execution.pins.briefRevision
    || checkpoint.contextRevision !== comparison.contextRevision || checkpoint.taskId !== comparison.taskId
    || checkpoint.policyVersion !== execution.pins.policyVersion) throw new Error("Incomplete comparison.");
  if (comparison.question) return { question: comparison.question };
  const sources = checkpoint.sources.filter(source => comparison.sourceRefs.some(ref => ref.runId === source.runId && ref.sourceId === source.sourceId));
  return { outcome: { kind: "limited" as const, headline: `${plan.kind === "winery" ? "Winery" : "Transport"} comparison ready`,
    detail: comparison.evidenceMode === "fixture" ? "Synthetic fixture comparison only. No real supplier availability was checked or booked."
      : "Reference comparison only. Availability and booking terms still need checking; nothing was booked.",
    sources: comparison.evidenceMode === "fixture" ? [] : sources.slice(0, 12).map(source => ({ title: source.title.slice(0, 160), url: publicResearchUrl(source.url) })),
    unknowns: [...new Set(["Current availability is unverified.", ...comparison.limitations])].slice(0, 8).map(value => value.slice(0, 240)),
    receipt: null, retrievedAt: sources.map(source => source.retrievedAt).sort().at(-1) ?? null } };
}

/** Fixture-only qualification adapter. Nothing registers this in production.
 * Real tools/model policies need a separately reviewed activation and budget.
 */
type FixtureOptions = {
  provider: ResearchProvider; providerName: string; extractor: DecisionExtractor;
  publicQuery: Parameters<typeof researchDecisionRepository>[1]["publicQuery"];
  trace?: (event: DecisionTrace) => void;
};
export function createFixtureResearchDecisionWorkflow(options: FixtureOptions): WorkflowWorkerHandler {
  return fixtureWorkflow(options, false);
}
/** Still test-only and unregistered: qualifies source validation and durable
 * human input review with synthetic sources. No live provider or mounted host.
 */
export function createSavedFixtureResearchDecisionWorkflow(options: FixtureOptions): WorkflowWorkerHandler {
  return fixtureWorkflow(options, true);
}
function fixtureWorkflow(options: FixtureOptions, saved: boolean): WorkflowWorkerHandler {
  const toolIds = { search: "fixture-decision-search", read: "fixture-decision-read", extract: "fixture-decision-extract" };
  const contract: WorkflowHandlerContract = {
    key: saved ? "fixture-saved-research-decision" : "fixture-research-decision", version: 1, artifactKind: "research_decision", recipes: RESEARCH_DECISION_RECIPES,
    maxCalls: 20, maxSteps: 64,
    tools: Object.values(toolIds).map(id => ({ id, billing: "fixture", upperBoundCents: 0 })),
    // The saved adapter always requires the common human-review command. The
    // legacy synthetic adapter cannot accept v2 input or bypass its source seal.
    validateInput: (value, scope) => value.schemaVersion === (saved ? 2 : 1) && validResearchDecisionInput(value, scope),
    ...(saved ? { validateSavedContext: validSavedResearchDecisionContext, requiresReviewedInput: true as const } : {}),
    validateCheckpoint: validResearchDecisionCheckpoint,
    validateComparison: (value, scope) => validResearchDecisionComparison(value, scope) && value.evidenceMode === "fixture",
    completion,
  };
  return { contract, async run(stage) {
    const adapter = researchDecisionRepository(stage, { mode: "fixture", toolIds, publicQuery: options.publicQuery });
    const provider: ResearchProvider = {
      search: (query, call) => adapter.call("search", () => options.provider.search(query, call)),
      read: (urls, call) => adapter.call("read", () => options.provider.read(urls, call)),
    };
    const extractor: DecisionExtractor = { name: options.extractor.name, policyVersion: options.extractor.policyVersion,
      extract: (input, call) => adapter.call("extract", () => options.extractor.extract(input, call)) };
    const result = await runResearchDecisionStep(adapter.invocation, { store: adapter.store, provider, providerName: options.providerName,
      extractor, signal: stage.signal, trace: options.trace });
    if (result.state === "stale" || result.state === "cancelled") throw new Error("Research stage is no longer current.");
    return result.state === "comparison_ready" ? "complete" : "yield";
  } };
}
