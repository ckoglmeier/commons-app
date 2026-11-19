import { CoordinatorTasksSchema, type CoordinatorTask, type TurnSteering } from "@commons/contracts";
import { coordinatorEndpoint, requestJson } from "@/lib/coordinator-client";

/*
 * Browser side of the Tasks route. Framework-free so the panel and tests share the same rules for wording, completion announcements and idempotent commands.
 * Nothing here decides authority: the server re-checks organizer standing, ownership and revision, and a refusal is shown as the server worded it.
 */

export type TaskCapability = { steering: boolean; available: boolean; reason: "off" | "provider" | "runner" | null };
export const tasksEndpoint = (slug: string) => `${coordinatorEndpoint(slug)}/tasks`;
export const continuityEndpoint = (slug: string) => `${coordinatorEndpoint(slug)}/continuity`;

export async function loadTasks(slug: string, threadId: string, signal?: AbortSignal) {
  const body = await requestJson<{ capability: TaskCapability; tasks: unknown }>(`${tasksEndpoint(slug)}?threadId=${encodeURIComponent(threadId)}`, { cache: "no-store", ...(signal ? { signal } : {}) });
  return { capability: body.capability, tasks: CoordinatorTasksSchema.parse(body.tasks) };
}

/** The plain-words state of a task: always text, never colour alone. */
export function taskStatusText(task: Pick<CoordinatorTask, "status" | "waitingForSlot" | "resultOutdated" | "errorCode">) {
  switch (task.status) {
    case "queued": return task.waitingForSlot ? "Waiting for a free slot" : "Queued";
    case "running": return "Working";
    case "needs_input": return "Needs your answer";
    case "succeeded": return task.resultOutdated ? "Earlier result is out of date" : "Result ready";
    case "failed": return task.errorCode === "access_revoked" ? "Stopped: access changed" : "Stopped without a result";
    case "cancelled": return "Cancelled";
  }
}
export const isLive = (task: Pick<CoordinatorTask, "status">) => task.status === "queued" || task.status === "running" || task.status === "needs_input";

/** One short line for what last changed, from the stored history. */
export function lastChangeText(task: CoordinatorTask) {
  const change = task.lastChange;
  if (!change) return null;
  const when = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(change.at));
  switch (change.kind) {
    case "started": return `Started ${when}`;
    case "amended": return `Correction accepted ${when}${change.summary ? `: ${change.summary}` : ""}`;
    case "cancelled": return change.summary === "no_change" ? `Cancel requested ${when}; it had already stopped` : `Cancelled ${when}`;
    case "completed": return `Finished ${when}`;
    case "failed": return `Stopped ${when}`;
  }
}

/**
 * One announcement per task revision that finishes while this page is open. A reload or a poll that merely sees an old result announces nothing, and a
 * revision already announced is never announced again. `seen` is mutated so the same set can be reused across polls.
 */
export function newlyFinished(previous: readonly CoordinatorTask[] | null, next: readonly CoordinatorTask[], seen: Set<string>) {
  if (!previous) return [];
  const finished: CoordinatorTask[] = [];
  for (const task of next) {
    const before = previous.find(item => item.taskId === task.taskId);
    const key = `${task.taskId}:${task.revision}`;
    if (before && task.status === "succeeded" && !task.resultOutdated && !seen.has(key) && (before.status !== "succeeded" || before.resultOutdated || before.revision !== task.revision)) { seen.add(key); finished.push(task); }
  }
  return finished;
}

/** Same task and words keep the same command id, so a retry, a second tab or a reload sends one operation. */
export class StableCommands {
  private ids = new Map<string, string>();
  idFor(key: string) { let id = this.ids.get(key); if (!id) { id = crypto.randomUUID(); this.ids.set(key, id); } return id; }
  settle(key: string) { this.ids.delete(key); }
}

export type TaskRefusal = { message: string; code: string | null; currentRevision?: number };
/** Run one task operation; returns the task as the server now has it, or the server's own wording of why not. */
export async function runTaskOperation(slug: string, body: Record<string, unknown>): Promise<{ ok: true; task: CoordinatorTask; cancelled?: boolean; replayed?: boolean } | { ok: false; refusal: TaskRefusal }> {
  try {
    const response = await fetch(tasksEndpoint(slug), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await response.json().catch(() => null) as { task?: unknown; error?: string; code?: string; currentRevision?: number; cancelled?: boolean; replayed?: boolean } | null;
    if (response.ok && json?.task) {
      const [task] = CoordinatorTasksSchema.parse([json.task]);
      return { ok: true, task, ...(json.cancelled !== undefined ? { cancelled: json.cancelled } : {}), ...(json.replayed !== undefined ? { replayed: json.replayed } : {}) };
    }
    return { ok: false, refusal: { message: json?.error ?? "That didn’t go through. Nothing was changed. Check the task, then try again.", code: json?.code ?? null, ...(json?.currentRevision ? { currentRevision: json.currentRevision } : {}) } };
  } catch { return { ok: false, refusal: { message: "Connection interrupted. Check the task before trying again; a repeated request is only applied once.", code: null } }; }
}

/** A clarification the organizer answered by choosing a task becomes a normal turn with an explicit action, so it is saved in the conversation. */
export function clarifyChoice(steering: Extract<TurnSteering, { kind: "clarify" }>, taskId: string) {
  const candidate = steering.candidates.find(item => item.taskId === taskId);
  if (!candidate) return null;
  return { text: steering.message, explicitAction: { kind: "task_control" as const, op: steering.operation, taskId: candidate.taskId, expectedRevision: candidate.revision } };
}
