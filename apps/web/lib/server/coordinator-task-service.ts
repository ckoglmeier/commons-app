import type { CoordinatorTask, TripContextSnapshot } from "@commons/contracts";
import { CommandAccessError, GoalRevisionConflict, TaskLimitError, TaskNotAmendableError, TaskRevisionConflictError, type AmendOutcome, type CancelOutcome, type TaskView } from "@commons/database";
import { sanitizeTypedResearchQuery } from "@/lib/server/coordinator-research-query";
import { coordinatorSteeringEnabled, coordinatorTasksAvailable, coordinatorGoalsEnabled } from "@/lib/server/runtime-environment";
import { amendAuthenticatedCoordinatorTask, authenticatedCoordinatorTasks, cancelAuthenticatedCoordinatorTask, loadAuthenticatedTripContext, startAuthenticatedCoordinatorTask } from "@/lib/server/polls";

/*
 * The one place task operations are decided for the Tasks route and for the coordinator turn. Expected refusals are results, not exceptions, so each caller
 * can say exactly what happened; anything unexpected (authorization, database) still throws and maps to the stable coordinator error codes.
 */

export type TaskApi = {
  list: (slug: string, threadId: string) => Promise<TaskView[]>;
  start: typeof startAuthenticatedCoordinatorTask;
  amend: typeof amendAuthenticatedCoordinatorTask;
  cancel: typeof cancelAuthenticatedCoordinatorTask;
  tripContext: (slug: string) => Promise<TripContextSnapshot>;
};
export const defaultTaskApi: TaskApi = {
  list: authenticatedCoordinatorTasks,
  start: startAuthenticatedCoordinatorTask, amend: amendAuthenticatedCoordinatorTask, cancel: cancelAuthenticatedCoordinatorTask,
  tripContext: slug => loadAuthenticatedTripContext(slug),
};

/** What the web layer is allowed to tell a person about tasks right now. Derived only from configuration, never from a promise. */
export function taskCapability(environment: { [name: string]: unknown } = process.env) {
  const steering = coordinatorSteeringEnabled(environment) || coordinatorGoalsEnabled(environment), available = coordinatorTasksAvailable(environment);
  const reason = !steering ? "off" as const : available ? null : String(environment.COMMONS_DURABLE_RESEARCH_ENABLED ?? "").trim() !== "true" || !String(environment.TAVILY_API_KEY ?? "").trim() ? "provider" as const : "runner" as const;
  return { steering, available, reason };
}

/** Fixed fields only: which operation, what happened, whether a retry was replayed, and how long it took. No ids of people, no text, no titles. */
function logOperation(op: "start" | "amend" | "cancel", outcome: string, started: number, extra: { replayed?: boolean; supersededRunning?: boolean } = {}) {
  console.info("commons.coordinator.task_op", { op, outcome, replayed: extra.replayed ?? false, supersededRunning: extra.supersededRunning ?? false, ms: Date.now() - started });
}

export const toTask = (view: TaskView): CoordinatorTask => ({
  taskId: view.taskId, threadId: view.threadId, title: view.title, brief: view.brief, revision: view.revision, status: view.status, errorCode: view.errorCode,
  waitingForSlot: view.waitingForSlot, needsInput: view.needsInput, resultOutdated: view.resultOutdated, hasResult: view.hasResult, currentRunId: view.currentRunId, runIds: view.runIds,
  ownedByMe: view.ownedByMe, requestedByName: view.requestedByName, acceptedAt: view.acceptedAt, updatedAt: view.updatedAt, lastChange: view.lastChange, steered: view.steered,
});

export type StartResult = { ok: true; task: TaskView } | { ok: false; reason: "unavailable" | "unsafe_query" | "limit" };
export async function startTaskOp(slug: string, input: { commandId: string; threadId: string; title: string; brief: string; query: string }, deps: Partial<TaskApi> & { environment?: { [name: string]: unknown } } = {}): Promise<StartResult> {
  const api = { ...defaultTaskApi, ...deps }, started = Date.now();
  if (!taskCapability(deps.environment).available && !coordinatorGoalsEnabled(deps.environment)) { logOperation("start", "unavailable", started); return { ok: false, reason: "unavailable" }; }
  // Second check, same filter as the typed research box: only a query without private trip terms may leave Commons.
  const safe = sanitizeTypedResearchQuery(input.query, await api.tripContext(slug));
  if (!safe) { logOperation("start", "unsafe_query", started); return { ok: false, reason: "unsafe_query" }; }
  try { const done = { ok: true as const, task: (await api.start(slug, { ...input, query: safe.query })).task }; logOperation("start", "started", started); return done; }
  catch (error) {
    // The per-organizer outstanding bound and the hourly bound both surface as a conflict from the repository.
    if (error instanceof TaskLimitError) { logOperation("start", "limit", started); return { ok: false, reason: "limit" }; }
    throw error;
  }
}

export type AmendResult =
  | { ok: true; task: TaskView; replayed: boolean; supersededRunning: boolean }
  | { ok: false; reason: "stale_revision"; currentRevision: number } | { ok: false; reason: "not_amendable" | "not_found" | "unsafe_query" };
export async function amendTaskOp(slug: string, input: { commandId: string; threadId: string; taskId: string; expectedRevision: number; note: string; query?: string; missingFact?: string }, deps: Partial<TaskApi> = {}): Promise<AmendResult> {
  const api = { ...defaultTaskApi, ...deps }, started = Date.now();
  let publicQuery: string | undefined;
  if (input.query) {
    const safe = sanitizeTypedResearchQuery(input.query, await api.tripContext(slug));
    if (!safe) return { ok: false, reason: "unsafe_query" };
    publicQuery = safe.query;
  }
  try {
    const outcome: AmendOutcome = await api.amend(slug, { threadId: input.threadId, taskId: input.taskId, commandId: input.commandId, expectedRevision: input.expectedRevision, note: input.note,
      ...(publicQuery ? { publicQuery } : {}), ...(input.missingFact ? { missingFact: input.missingFact } : {}) });
    logOperation("amend", outcome.replayed ? "replayed" : "amended", started, outcome);
    return { ok: true, task: outcome.task, replayed: outcome.replayed, supersededRunning: outcome.supersededRunning };
  } catch (error) {
    if (error instanceof TaskRevisionConflictError || error instanceof GoalRevisionConflict) { logOperation("amend", "stale_revision", started); return { ok: false, reason: "stale_revision", currentRevision: error.currentRevision }; }
    if (error instanceof TaskNotAmendableError) { logOperation("amend", "not_amendable", started); return { ok: false, reason: "not_amendable" }; }
    // Another organizer's task, a missing task and a task in another trip all read the same: not found, never "not yours".
    if (error instanceof CommandAccessError) { logOperation("amend", "not_found", started); return { ok: false, reason: "not_found" }; }
    throw error;
  }
}

export type CancelResult = { ok: true; task: TaskView; cancelled: boolean; replayed: boolean } | { ok: false; reason: "not_found" };
export async function cancelTaskOp(slug: string, input: { commandId: string; threadId: string; taskId: string }, deps: Partial<TaskApi> = {}): Promise<CancelResult> {
  const api = { ...defaultTaskApi, ...deps }, started = Date.now();
  try {
    const outcome: CancelOutcome = await api.cancel(slug, input);
    logOperation("cancel", outcome.replayed ? "replayed" : outcome.cancelled ? "cancelled" : "no_change", started, outcome);
    return { ok: true, task: outcome.task, cancelled: outcome.cancelled, replayed: outcome.replayed };
  } catch (error) {
    if (error instanceof CommandAccessError) { logOperation("cancel", "not_found", started); return { ok: false, reason: "not_found" }; }
    throw error;
  }
}
