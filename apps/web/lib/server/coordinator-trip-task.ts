import { listTripTasks } from "@commons/database";
import { CoordinatorTripTaskProposalSchema } from "@commons/contracts";
import { tripTaskOperation } from "../coordinator-artifact-intent";
import { authenticatedGoalOptions } from "./polls";
import { derivedUuid } from "./coordinator-routing";
import type { DispatchInput, DispatchResult } from "./coordinator-capabilities";

export async function dispatchTripTask(input: DispatchInput, quickAdd = false): Promise<DispatchResult> {
  const operation = tripTaskOperation(input.prompt), options = await authenticatedGoalOptions(input.slug);
  const previous = input.thread.turns.filter(turn => turn.threadId === input.threadId && turn.id !== input.currentTurnId && (!turn.status || turn.status === "completed"))
    .findLast(turn => turn.workspace?.taskProposal)?.workspace?.taskProposal;
  let proposal;
  if (operation?.kind === "create") {
    // v1 assigns only to the requesting organizer; named third-party assignments require the direct task editor.
    // A task title can say “Ask Kevin for coffee” or “Find a room for two”.
    // Preserve the existing assignment/owner guard, but scope “for” to
    // the task header rather than treating every title as ownership syntax.
    const namedAssignment = /\b(?:assign|assigned|owner)\b|\b(?:task|todo|to-do)\s+for\s+(?!me\b|the\b|our\b)/i.test(input.prompt);
    if (!namedAssignment) proposal = { version: 1, state: "pending", quickAdd, requestedBy: options.actorPersonId, receipt: null,
      task: { id: derivedUuid(input.idSeed ?? input.commandId, "trip-task"), commandId: derivedUuid(input.idSeed ?? input.commandId, "save-trip-task"), expectedVersion: 0,
        title: operation.title, ownerPersonId: options.actorPersonId, dueOn: null, completed: false, itemKind: null, itemId: null } };
  } else if (operation && previous && previous.state !== "dismissed" && previous.requestedBy === options.actorPersonId) {
    const saved = (await listTripTasks(input.slug, options)).find(task => task.id === previous.task.id);
    const title = operation.kind === "rename" ? operation.text : `${previous.task.title}; ${operation.text}`;
    const expectedSavedVersion = previous.state === "applied" ? previous.receipt?.version : previous.task.expectedVersion;
    if (title.length <= 160 && (!saved || saved.version === expectedSavedVersion)) proposal = { ...previous, quickAdd: false, version: previous.version + 1, state: "pending", receipt: null,
      task: { ...previous.task, commandId: derivedUuid(input.idSeed ?? input.commandId, "save-trip-task"), expectedVersion: saved?.version ?? previous.task.expectedVersion, title,
        ...(saved ? { dueOn: saved.dueOn, completed: saved.completed, itemKind: saved.itemKind, itemId: saved.itemId, ownerPersonId: saved.ownerPersonId } : {}) } };
  }
  const taskProposal = proposal ? CoordinatorTripTaskProposalSchema.parse(proposal) : undefined;
  const answer = taskProposal ? "Task suggestion ready. Review it below; nothing is saved until you choose Save task. No booking or supplier contact."
    : "I couldn’t safely prepare that task. Use the task editor to choose its owner and details, or name a shorter task for yourself. Nothing changed.";
  return { capability: "propose_trip_change", modelTier: "none", assistantText: answer, spokenReply: answer,
    workspace: { tripConversation: true, ...(taskProposal ? { taskProposal } : {}) }, data: null, attendanceStatement: false,
    topicTitle: taskProposal ? "Organize logistics" : null, threadSummary: null, openQuestions: null, sources: [], model: null, providerMs: 0,
    detail: { retrievedThreads: 0, researchQueryChars: null, sourceCount: 0, navigation: null, unsupportedReason: null } };
}
