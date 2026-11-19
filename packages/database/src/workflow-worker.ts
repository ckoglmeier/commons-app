import type { WorkflowExecution } from "@commons/contracts";
import { recordResearchWorkerHeartbeat, recordWorkflowWorkerHeartbeat } from "./coordinator-worker-health";
import { claimResearchTask, type TaskLease } from "./research-task-repository";
import { loadWorkflowExecution, reserveWorkflowCall, commitWorkflowCheckpoint, settleWorkflowStage, type WorkflowHandlerContract } from "./workflow-execution-repository";

/** Injectable code-owned handlers. There is deliberately no production registry,
 * provider selection, prompt loop or funding fallback in this package.
 */
export type WorkflowWorkerHandler = { contract: WorkflowHandlerContract; run: (input: {
  lease: TaskLease; execution: WorkflowExecution; signal: AbortSignal;
  port: {
    load: () => ReturnType<typeof loadWorkflowExecution>;
    reserve: (input: Parameters<typeof reserveWorkflowCall>[1]) => ReturnType<typeof reserveWorkflowCall>;
    commit: (input: Parameters<typeof commitWorkflowCheckpoint>[1]) => ReturnType<typeof commitWorkflowCheckpoint>;
  };
}) => Promise<"yield" | "complete"> };
export type WorkflowWorkerObservation = { taskId: string; attempt: number; commandId: string; traceId: string | null;
  handler: string; recipeKey: string; recipeVersion: number; policyVersion: string; callsReserved: number; stage: number; outcome: "started" | "yielded" | "ready" | "needs_input" | "failed" | "stale"; ms: number };

/** Reuses the existing queue/lease and its 25-second finite lifetime. Work is
 * independent of a browser request, and every port operation rechecks authority.
 */
export async function runWorkflowTask(handlers: readonly WorkflowWorkerHandler[], options: { databaseUrl?: string; now?: () => Date; timeoutMs?: number; checkpointMs?: number; observe?: (event: WorkflowWorkerObservation) => void } = {}) {
  const clock = options.now ?? (() => new Date()), registry = handlers.map(h => h.contract);
  if (new Set(registry.map(h => `${h.key}:${h.version}`)).size !== registry.length) throw new Error("Duplicate workflow handler.");
  if (!handlers.length) return { processed: false as const };
  await recordResearchWorkerHeartbeat(options.databaseUrl, clock());
  for (const handler of registry) await recordWorkflowWorkerHeartbeat(handler, options.databaseUrl, clock());
  let lease: TaskLease | null = null, selected: WorkflowWorkerHandler | undefined;
  for (const handler of handlers) {
    lease = await claimResearchTask(options.databaseUrl, clock(), handler.contract);
    if (lease) { selected = handler; break; }
  }
  if (!lease || !selected) return { processed: false as const };
  const claim = lease, handler = selected, started = Date.now(), controller = new AbortController();
  let checking = false, execution: WorkflowExecution | undefined, watcher: ReturnType<typeof setInterval> | undefined;
  const observe = (outcome: WorkflowWorkerObservation["outcome"]) => {
    if (!execution) return;
    try { options.observe?.({ taskId: claim.taskId, attempt: claim.attempt, commandId: execution.correlation.commandId, traceId: execution.correlation.traceId,
      handler: execution.handler.key, recipeKey: execution.pins.recipe.key, recipeVersion: execution.pins.recipe.version, policyVersion: execution.pins.policyVersion,
      callsReserved: execution.usage.calls, stage: execution.usage.steps, outcome, ms: Date.now() - started }); } catch { /* Metadata observation cannot change execution. */ }
  };
  const abort = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("Workflow stopped.")), { once: true }));
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(25_000, options.timeoutMs ?? 25_000)));
  const load = () => loadWorkflowExecution(claim, options.databaseUrl, registry, clock());
  try {
    const work = async () => {
      const loaded = await load(); execution = loaded.execution; controller.signal.throwIfAborted(); observe("started");
      // A previous process left a reservation without durable completion. Do not
      // even enter the domain handler, which might otherwise repeat that call.
      if (loaded.cumulative.outstandingReservations > 0) {
        execution = await settleWorkflowStage(claim, { expectedRevision: execution.revision, action: "uncertain" }, options.databaseUrl, registry, clock());
        observe("needs_input"); return;
      }
      if ((options.checkpointMs ?? 2000) > 0) watcher = setInterval(() => {
        if (checking || controller.signal.aborted) return; checking = true;
        load().catch(() => controller.abort()).finally(() => { checking = false; });
      }, options.checkpointMs ?? 2000);
      const action = await handler.run({ lease: claim, execution, signal: controller.signal, port: { load,
        reserve: input => { controller.signal.throwIfAborted(); return reserveWorkflowCall(claim, input, options.databaseUrl, registry, clock()); },
        commit: input => { controller.signal.throwIfAborted(); return commitWorkflowCheckpoint(claim, input, options.databaseUrl, registry, clock()); },
      } });
      controller.signal.throwIfAborted(); execution = (await load()).execution;
      execution = await settleWorkflowStage(claim, { expectedRevision: execution.revision, action }, options.databaseUrl, registry, clock());
      observe(execution.status === "needs_input" ? "needs_input" : execution.status === "ready" ? "ready" : "yielded");
    };
    await Promise.race([work(), abort]);
    return { processed: true as const, taskId: claim.taskId, outcome: execution!.status };
  } catch {
    controller.abort();
    try { execution = await settleWorkflowStage(claim, { action: "failed" }, options.databaseUrl, registry, clock()); observe(execution.status === "needs_input" ? "needs_input" : "failed");
      return { processed: true as const, taskId: claim.taskId, outcome: execution.status };
    } catch { observe("stale"); return { processed: false as const, taskId: claim.taskId, outcome: "stale" as const }; }
  } finally { clearTimeout(timer); clearInterval(watcher); }
}
