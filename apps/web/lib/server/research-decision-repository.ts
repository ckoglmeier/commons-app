import { randomUUID } from "node:crypto";
import {
  ResearchDecisionBriefSchema, ResearchDecisionCheckpointSchema, ResearchDecisionComparisonSchema,
  type WorkflowExecution, type WorkflowJson,
} from "@commons/contracts";
import { WorkflowExecutionConflict, type WorkflowWorkerHandler, type WorkflowValidationScope } from "@commons/database";
import type { DecisionInvocation, ResearchDecisionStore } from "./research-decision-specialist";
import { ResearchDecisionInputSchema } from "./research-decision-input";
export { ResearchDecisionInputSchema, researchDecisionInput, validResearchDecisionInput } from "./research-decision-input";
export type { ResearchDecisionInput } from "./research-decision-input";

// Runtime identities/pins are not domain input fields. The shared binder obtains
// them under its transaction; the adapter reconstructs the full brief on load.
export function validResearchDecisionCheckpoint(value: Record<string, WorkflowJson>, scope: WorkflowValidationScope): boolean {
  const parsed = ResearchDecisionCheckpointSchema.safeParse(value);
  if (!parsed.success) return false;
  const c = parsed.data;
  return c.taskId === scope.taskId && c.briefRevision === scope.pins.briefRevision && c.contextRevision === scope.pins.contextVersion
    && c.recipeKey === scope.pins.recipe.key && c.recipeVersion === scope.pins.recipe.version && c.policyVersion === scope.pins.policyVersion;
}
export function validResearchDecisionComparison(value: Record<string, WorkflowJson>, scope: WorkflowValidationScope): boolean {
  const parsed = ResearchDecisionComparisonSchema.safeParse(value);
  if (!parsed.success) return false;
  const c = parsed.data;
  return c.id === scope.artifactId && c.taskId === scope.taskId && c.threadId === scope.threadId && c.ownerId === scope.actorId
    && c.briefRevision === scope.pins.briefRevision && c.contextRevision === scope.pins.contextVersion
    && scope.pins.recipe.key === `${c.kind}-decision-v1` && scope.pins.recipe.version === 1;
}
export type ResearchWorkflowStage = Parameters<WorkflowWorkerHandler["run"]>[0];
export type ResearchDecisionTool = "search" | "read" | "extract";
const payload = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, WorkflowJson>;

/** Adapter only: every read/reserve/CAS goes through the shared authorized port.
 * No SQL, task queue, database client, credentials, or production registration.
 */
export function researchDecisionRepository(stage: ResearchWorkflowStage, options: {
  mode: "fixture" | "public_reference";
  toolIds: Record<ResearchDecisionTool, string>;
  publicQuery: (query: string, stage: ResearchWorkflowStage) => Promise<string | null>;
}) {
  let execution = stage.execution;
  const completed = new Set<string>();
  const invocation: DecisionInvocation = { taskId: stage.lease.taskId, actorId: stage.lease.actorPersonId, leaseToken: stage.lease.attemptId };
  function identity(i: DecisionInvocation) {
    stage.signal.throwIfAborted();
    if (i.taskId !== invocation.taskId || i.actorId !== invocation.actorId || i.leaseToken !== invocation.leaseToken)
      throw new Error("Research invocation is outside its authorized stage.");
  }
  function project(e: WorkflowExecution) {
    const input = ResearchDecisionInputSchema.parse(e.input);
    if (options.mode === "public_reference" && input.schemaVersion !== 2) throw new Error("Public research requires atomic saved-context validation.");
    const brief = ResearchDecisionBriefSchema.parse({ ...input.plan, taskId: stage.lease.taskId,
      threadId: stage.lease.threadId, ownerId: stage.lease.actorPersonId, revision: e.pins.briefRevision,
      contextRevision: e.pins.contextVersion, recipe: { key: e.pins.recipe.key, version: e.pins.recipe.version } });
    if (e.artifact.kind !== "research_decision" || e.status !== "running"
      || e.pins.recipe.key !== `${brief.kind}-decision-v1` || e.pins.recipe.version !== 1) throw new Error("Unsupported research binding.");
    const checkpoint = e.checkpoint ? ResearchDecisionCheckpointSchema.parse(e.checkpoint.value) : null;
    const comparison = e.comparison ? ResearchDecisionComparisonSchema.parse(e.comparison.value) : null;
    if (checkpoint && (checkpoint.revision !== e.checkpoint!.revision || checkpoint.taskId !== brief.taskId
      || checkpoint.briefRevision !== brief.revision || checkpoint.contextRevision !== brief.contextRevision
      || checkpoint.recipeKey !== brief.recipe.key || checkpoint.recipeVersion !== brief.recipe.version
      || checkpoint.policyVersion !== e.pins.policyVersion || checkpoint.queryIndex > brief.queries.length
      || checkpoint.extractedSourceCount > checkpoint.sources.length)) throw new Error("Checkpoint binding changed.");
    if (comparison && (comparison.revision !== e.comparison!.revision || comparison.id !== e.artifact.id
      || comparison.taskId !== brief.taskId || comparison.threadId !== brief.threadId || comparison.ownerId !== brief.ownerId
      || comparison.briefRevision !== brief.revision || comparison.contextRevision !== brief.contextRevision
      || comparison.kind !== brief.kind || comparison.evidenceMode !== options.mode)) throw new Error("Comparison binding changed.");
    return { brief, checkpoint, comparison };
  }
  async function loadCurrent() {
    stage.signal.throwIfAborted();
    const loaded = await stage.port.load();
    stage.signal.throwIfAborted();
    if (loaded.execution.revision !== execution.revision) throw new WorkflowExecutionConflict("stale_execution");
    project(loaded.execution);
    return loaded;
  }
  const store: ResearchDecisionStore = {
    async load(i) {
      identity(i); const loaded = await loadCurrent(), domain = project(loaded.execution);
      return { ...domain, comparisonId: execution.artifact.id, mode: options.mode,
        // Domain counters describe this brief. The shared ledger is cumulative
        // across amendments; its remaining allowance can never be reset here.
        maxCalls: Math.min(20, (domain.checkpoint?.callsUsed ?? 0) + Math.max(0, execution.budget.maxCalls - loaded.cumulative.calls)),
        deadlineAt: Date.parse(execution.budget.deadlineAt), policyVersion: execution.pins.policyVersion };
    },
    async isCurrent(i, brief) {
      identity(i);
      try { const { execution: e } = await loadCurrent(); const current = project(e).brief;
        return JSON.stringify(current) === JSON.stringify(brief);
      } catch (error) { if (error instanceof WorkflowExecutionConflict) return false; throw error; }
    },
    async commit(i, expected, update) {
      identity(i);
      try {
        await loadCurrent(); const prior = project(execution), next = ResearchDecisionCheckpointSchema.parse(update.checkpoint);
        if (expected.briefRevision !== prior.brief.revision || expected.contextRevision !== prior.brief.contextRevision
          || expected.checkpointRevision !== (prior.checkpoint?.revision ?? null)
          || expected.comparisonRevision !== (prior.comparison?.revision ?? null)) return false;
        if (prior.checkpoint && (next.queryIndex < prior.checkpoint.queryIndex || next.extractedSourceCount < prior.checkpoint.extractedSourceCount
          || next.callsUsed < prior.checkpoint.callsUsed || next.sources.length < prior.checkpoint.sources.length
          || JSON.stringify(next.sources.slice(0, prior.checkpoint.sources.length)) !== JSON.stringify(prior.checkpoint.sources))) return false;
        const comparison = update.comparison && ResearchDecisionComparisonSchema.parse(update.comparison);
        const proposed: WorkflowExecution = { ...execution, checkpoint: { revision: next.revision, value: payload(next) },
          ...(comparison ? { comparison: { revision: comparison.revision, value: payload(comparison) } } : {}) };
        project(proposed);
        // Intermediate callsUsed writes are NOT evidence checkpoints. Retain
        // reservations until search/extraction output is durably represented.
        const progressed = next.queryIndex > (prior.checkpoint?.queryIndex ?? 0)
          || next.extractedSourceCount > (prior.checkpoint?.extractedSourceCount ?? 0);
        const acknowledged = progressed ? [...completed] : [];
        execution = await stage.port.commit({ expectedRevision: execution.revision, checkpoint: proposed.checkpoint,
          ...(comparison ? { comparison: proposed.comparison } : {}), completedReservations: acknowledged });
        for (const id of acknowledged) completed.delete(id);
        return true;
      } catch (error) { if (error instanceof WorkflowExecutionConflict) return false; throw error; }
    },
    async publicQuery(i, query) {
      identity(i); await loadCurrent();
      if (!project(execution).brief.queries.some(q => q.text === query)) return null;
      const approved = await options.publicQuery(query, { ...stage, execution });
      await loadCurrent();
      return approved === query ? approved : null;
    },
  };
  async function call<T>(tool: ResearchDecisionTool, operation: () => Promise<T>): Promise<T> {
    await loadCurrent();
    const reservationId = randomUUID();
    execution = await stage.port.reserve({ expectedRevision: execution.revision, toolId: options.toolIds[tool], reservationId });
    stage.signal.throwIfAborted();
    const result = await operation();
    stage.signal.throwIfAborted();
    completed.add(reservationId);
    return result;
  }
  return { store, invocation, call };
}
