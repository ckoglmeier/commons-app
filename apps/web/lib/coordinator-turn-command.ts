import type { CoordinatorThread, TurnCommand } from "@commons/contracts";

type Turn = CoordinatorThread["turns"][number];

/**
 * The artifact a message is about, from the Workspace selection and the latest thread payload. One artifact per command:
 * an editable draft wins (the organizer is working on it), then a saved note, then a poll.
 * Reading the latest payload at send time (not render time) keeps a delayed or spoken send from using a stale draft version.
 */
export function selectedArtifact(thread: CoordinatorThread, selected: string): TurnCommand["artifact"] | undefined {
  const threadId = selected.startsWith("thread:") ? selected.slice(7) : undefined;
  const editable = thread.drafts.filter(draft => !draft.publishedPollId && !draft.archivedAt);
  const goalDraft = threadId ? thread.drafts.filter(draft => draft.threadId === threadId && !draft.archivedAt).at(-1) : undefined;
  const goalPoll = threadId ? thread.polls.filter(poll => poll.threadId === threadId && !poll.archivedAt).at(-1) : undefined;
  const draft = editable.find(item => selected === `draft:${item.id}`) ?? (goalDraft && !goalDraft.publishedPollId ? goalDraft : undefined);
  // A draft the organizer chose (`draft:<id>`) is `selected` for routing. The thread's goal draft is attached to every turn as context only: it
  // is marked so the router never lets the attachment itself steer a turn into poll editing.
  if (draft) return { kind: "draft", id: draft.id, version: draft.version, ...(selected === `draft:${draft.id}` ? {} : { selection: "thread_context" as const }) };
  if (selected.startsWith("note:")) return { kind: "note", turnId: selected.slice(5) };
  const pollId = selected.startsWith("poll:") ? selected.slice(5) : goalPoll?.id ?? goalDraft?.publishedPollId ?? undefined;
  return pollId ? { kind: "poll", id: pollId } : undefined;
}

/**
 * Rebuilds the command behind a failed turn when the browser no longer has it (another device, cleared storage), so Try again can
 * reuse the same command id. The server matches a retry to its saved request by fingerprint; anything that cannot be rebuilt exactly
 * (a research query, an Ask the group starter) comes back as `command_mismatch`, and the Workspace then returns the text to the message box.
 */
export function retryCommandFor(turn: Turn, thread: CoordinatorThread, expectedTurnVersion: number): TurnCommand | null {
  if (!turn.commandId || !turn.threadId) return null;
  const draft = turn.draftId ? thread.drafts.find(item => item.id === turn.draftId) : undefined;
  // The original marker cannot be recovered, so a rebuilt retry treats the draft as context (the conservative reading; the server fingerprint ignores it).
  const artifact: TurnCommand["artifact"] | undefined = draft ? { kind: "draft", id: draft.id, version: draft.version, selection: "thread_context" }
    : turn.contextPollId ? { kind: "poll", id: turn.contextPollId }
    : turn.contextTurnId ? { kind: "note", turnId: turn.contextTurnId } : undefined;
  const inputMode = turn.inputMode ?? "text";
  // A thread's first turn is created together with the thread; that is the only place a `new` target came from.
  const first = turn.sequence === 1;
  return {
    commandId: turn.commandId,
    target: first ? { kind: "new", threadId: turn.threadId } : { kind: "existing", threadId: turn.threadId, expectedTurnVersion },
    inputMode, text: turn.userText.trim(),
    ...(artifact && !first ? { artifact } : {}),
    ...(inputMode === "voice" ? { voice: { sessionId: "retry", delegationId: turn.commandId } } : {}),
  };
}

/** True when a turn was written by the actor; only the author can look up or retry its command. */
export function isOwnTurn(turn: Turn, actorId: string | undefined) {
  return Boolean(actorId) && turn.authorPersonId === actorId;
}
