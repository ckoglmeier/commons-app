import { recordResearchWorkerHeartbeat } from "./coordinator-worker-health";
import type { CoordinatorResearch } from "@commons/contracts";
import { claimResearchTask, finishResearchTaskDetailed, researchLeaseIsCurrent } from "./research-task-repository";

export type TaskWorkerOutcome = { processed: false } | { processed: boolean; taskId: string; revision: number; outcome: string; abortedEarly: boolean };

/**
 * Transport-independent worker. Its lifetime never depends on a client signal.
 *
 * While the provider call runs, a checkpoint polls whether this claim is still the current, uncancelled, authorized one and aborts the provider call
 * when it is not. That only saves work: the database commit (finishResearchTaskDetailed) is what decides, so an abort that never arrives, or a worker
 * in another process, cannot publish a stale result.
 */
export async function runResearchTask(
  research: (query: string, signal: AbortSignal) => Promise<CoordinatorResearch>,
  options: { databaseUrl?: string; now?: () => Date; timeoutMs?: number; checkpointMs?: number; onFinished?: (event: { taskId: string; revision: number; outcome: string; abortedEarly: boolean; ms: number }) => void } = {},
): Promise<TaskWorkerOutcome> {
  const clock = options.now ?? (() => new Date());
  await recordResearchWorkerHeartbeat(options.databaseUrl,clock());
  const lease = await claimResearchTask(options.databaseUrl, clock());
  if (!lease) return { processed: false };
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined, watcher: ReturnType<typeof setInterval> | undefined, abortedEarly = false, checking = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("deadline")); }, Math.max(1, Math.min(options.timeoutMs ?? 25_000, 25_000)));
  });
  if ((options.checkpointMs ?? 2000) > 0) watcher = setInterval(() => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    researchLeaseIsCurrent(lease, options.databaseUrl, clock()).then(current => { if (!current) { abortedEarly = true; controller.abort(); } }, () => undefined).finally(() => { checking = false; });
  }, options.checkpointMs ?? 2000);
  let outcome: Parameters<typeof finishResearchTaskDetailed>[1];
  try { outcome = { result: await Promise.race([Promise.resolve().then(() => research(lease.query, controller.signal)), deadline]) }; }
  catch { outcome = { errorCode: abortedEarly ? "provider_failed" : controller.signal.aborted ? "deadline_exceeded" : "provider_failed" }; }
  finally { clearTimeout(timer); clearInterval(watcher); }
  // Even work that was told to stop goes through the same fenced commit; it is refused there if it is no longer current.
  const finished = await finishResearchTaskDetailed(lease, outcome, options.databaseUrl, clock());
  const label = finished.committed ? ("errorCode" in outcome ? outcome.errorCode : "committed") : finished.reason;
  options.onFinished?.({ taskId: lease.taskId, revision: lease.revision, outcome: label, abortedEarly, ms: Date.now() - started });
  return { processed: finished.committed, taskId: lease.taskId, revision: lease.revision, outcome: label, abortedEarly };
}
