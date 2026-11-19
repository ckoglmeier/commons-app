import { NextResponse } from "next/server";
import { z } from "zod";
import { TaskOperationRequestSchema } from "@commons/contracts";
import { readBoundedJson } from "@/lib/bounded-json";
import { legacyCoordinatorErrorResponse } from "@/lib/server/coordinator-errors";
import { amendTaskOp, cancelTaskOp, startTaskOp, taskCapability, toTask } from "@/lib/server/coordinator-task-service";
import { authenticatedCoordinatorTasks } from "@/lib/server/polls";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";

const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ slug: string }> };
const refusal = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error: message, code, retryable: status === 409, ...extra }, { status, headers });

/** Tasks in one thread, with what this deployment can actually do. Status reads need steering on; the older research panel still lists and cancels tasks when it is off. */
export async function GET(request: Request, context: Context) {
  try {
    const { slug } = await context.params;
    const threadId = z.string().uuid().parse(new URL(request.url).searchParams.get("threadId"));
    const capability = taskCapability();
    if (!capability.steering) return NextResponse.json({ capability, tasks: [] }, { headers });
    return NextResponse.json({ capability, tasks: (await authenticatedCoordinatorTasks(slug, threadId)).map(toTask) }, { headers });
  } catch (error) { return legacyCoordinatorErrorResponse(error); }
}

/**
 * Start, correct or cancel a task. Each is one idempotent command (`commandId`); a retry returns what happened the first time. Starting and correcting need
 * steering on; cancelling stays available for work that was already accepted. A correction names the revision it was written against.
 */
export async function POST(request: Request, context: Context) { const capabilityBlock = await agentCapabilityBlock((await context.params).slug); if (capabilityBlock) return capabilityBlock;
  try {
    const { slug } = await context.params;
    const input = TaskOperationRequestSchema.parse(await readBoundedJson(request, 4_000));
    const capability = taskCapability();
    if (input.op !== "cancel" && !capability.steering) return refusal(404, "steering_off", "This isn’t available yet.");
    if (input.op === "start") {
      const started = await startTaskOp(slug, input);
      if (started.ok) return NextResponse.json({ task: toTask(started.task) }, { status: 202, headers });
      if (started.reason === "unavailable") return refusal(503, "tasks_unavailable", capability.reason === "runner"
        ? "Background tasks aren’t running here yet, so nothing was started. You can still ask me in conversation."
        : "Background research isn’t connected here, so nothing was started. You can still ask me in conversation.");
      if (started.reason === "unsafe_query") return refusal(422, "unsafe_query", "That search would include private trip details, so nothing was started. Describe what to look up in general terms.");
      return refusal(409, "task_limit", "You already have several tasks in progress. Finish or cancel one, then start this again.");
    }
    if (input.op === "amend") {
      const amended = await amendTaskOp(slug, { commandId: input.commandId, threadId: input.threadId, taskId: input.taskId, expectedRevision: input.expectedRevision, note: input.note, ...(input.query ? { query: input.query } : {}) });
      if (amended.ok) return NextResponse.json({ task: toTask(amended.task), replayed: amended.replayed, supersededRunning: amended.supersededRunning }, { headers });
      if (amended.reason === "stale_revision") return refusal(409, "stale_revision", "This task changed since you last looked. It’s refreshed; check it and send your change again.", { currentRevision: amended.currentRevision });
      if (amended.reason === "not_amendable") return refusal(409, "task_not_amendable", "That task is no longer running, so it can’t be changed. Start a new task instead.");
      if (amended.reason === "unsafe_query") return refusal(422, "unsafe_query", "That search would include private trip details, so nothing was changed.");
      return refusal(404, "task_not_found", "That task isn’t available to change.");
    }
    const cancelled = await cancelTaskOp(slug, input);
    if (!cancelled.ok) return refusal(404, "task_not_found", "That task isn’t available to cancel.");
    return NextResponse.json({ task: toTask(cancelled.task), cancelled: cancelled.cancelled, replayed: cancelled.replayed }, { headers });
  } catch (error) { return legacyCoordinatorErrorResponse(error); }
}
