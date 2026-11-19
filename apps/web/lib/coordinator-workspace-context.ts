import type { CoordinatorThread } from "@commons/contracts";

/** Opening an artifact keeps the durable conversation that owns it; only older, unthreaded artifacts use the legacy route. */
export function workspaceThreadId(value: string, thread: CoordinatorThread): string | undefined {
  if (value.startsWith("thread:")) return value.slice(7);
  if (value.startsWith("research:")) return thread.turns.find(turn => turn.id === value.slice(9) && turn.workspace?.research)?.threadId ?? undefined;
  if (value.startsWith("itinerary:")) return thread.turns.find(turn => turn.workspace?.itineraryDraft?.id === value.slice(10))?.threadId ?? undefined;
  if (value.startsWith("draft:")) return thread.drafts.find(item => `draft:${item.id}` === value)?.threadId ?? undefined;
  if (value.startsWith("poll:")) return thread.polls.find(item => `poll:${item.id}` === value)?.threadId ?? undefined;
  if (value.startsWith("note:")) return thread.turns.find(item => `note:${item.id}` === value)?.threadId ?? undefined;
  return undefined;
}

/** An explicitly opened published poll must never be replaced by its thread's newer editable revision. */
export function workspaceEditableDraft(value: string, thread: CoordinatorThread) {
  if (value.startsWith("draft:")) return thread.drafts.find(item => `draft:${item.id}` === value && !item.publishedPollId && !item.archivedAt);
  if (!value.startsWith("thread:")) return undefined;
  const latest = thread.drafts.filter(item => item.threadId === value.slice(7) && !item.archivedAt).at(-1);
  return latest && !latest.publishedPollId ? latest : undefined;
}

export function defaultWorkspaceContext(thread: CoordinatorThread, initialDraftId?: string, initialPollId?:string, initialItineraryId?: string) {
  if (initialItineraryId && thread.turns.some(turn => turn.workspace?.itineraryDraft?.id === initialItineraryId)) return `itinerary:${initialItineraryId}`;
  if(initialPollId && thread.polls.some(item=>item.id===initialPollId && !item.archivedAt)) return `poll:${initialPollId}`;
  if (initialDraftId && thread.drafts.some(item => item.id === initialDraftId && !item.publishedPollId && !item.archivedAt)) return `draft:${initialDraftId}`;
  if (thread.activeThreadId && (thread.threads ?? []).some(item => item.id === thread.activeThreadId && item.status === "active")) return `thread:${thread.activeThreadId}`;
  const goal = (thread.threads ?? []).find(item => item.status === "active");
  if (goal) return `thread:${goal.id}`;
  const draft = thread.drafts.find(item => !item.threadId && !item.publishedPollId && !item.archivedAt);
  if (draft) return `draft:${draft.id}`;
  const poll = thread.polls.find(item => !item.threadId && !item.archivedAt);
  if (poll) return `poll:${poll.id}`;
  const note = thread.turns.find(item => !item.threadId && item.workspace?.saved && !item.workspace.archivedAt);
  return note ? `note:${note.id}` : "new";
}

export function validWorkspaceContext(value: string | null, thread: CoordinatorThread) {
  if (value?.startsWith("research:") && thread.turns.some(turn => turn.id === value.slice(9) && turn.workspace?.research)) return value;
  if (value?.startsWith("itinerary:") && thread.turns.some(turn => turn.workspace?.itineraryDraft?.id === value.slice(10))) return value;
  if (value?.startsWith("thread:") && (thread.threads ?? []).some(item => item.status === "active" && `thread:${item.id}` === value)) return value;
  if (value?.startsWith("draft:") && thread.drafts.some(item => !item.publishedPollId && !item.archivedAt && `draft:${item.id}` === value)) return value;
  if (value?.startsWith("poll:") && thread.polls.some(item => !item.archivedAt && `poll:${item.id}` === value)) return value;
  if (value?.startsWith("note:") && thread.turns.some(item => item.workspace?.saved && !item.workspace.archivedAt && `note:${item.id}` === value)) return value;
  return defaultWorkspaceContext(thread);
}

export function workspaceContextTitle(value: string, thread: CoordinatorThread) {
  const owner = workspaceThreadId(value, thread);
  const goal = (thread.threads ?? []).find(item => item.id === owner);
  if (goal) return goal.title;
  const draft = thread.drafts.find(item => `draft:${item.id}` === value);
  return draft?.data.title
    ?? thread.polls.find(item => `poll:${item.id}` === value)?.title
    ?? thread.turns.find(item => `note:${item.id}` === value && item.workspace?.saved)?.userText
    ?? "Start something new";
}

export function workspaceContextTurns(value: string, thread: CoordinatorThread) {
  const owner = workspaceThreadId(value, thread);
  if (owner) return thread.turns.filter(turn => turn.threadId === owner).slice().reverse();
  if (value.startsWith("thread:")) {
    const threadId = value.slice(7);
    return thread.turns.filter(turn => turn.threadId === threadId).slice().reverse();
  }
  const publishedDraftIds = thread.drafts.filter(draft => draft.publishedPollId && value === `poll:${draft.publishedPollId}`).map(draft => draft.id);
  if (value === "new") return [];
  return thread.turns.filter(turn => (value === `draft:${turn.draftId}`) || (value === `poll:${turn.contextPollId}`) || value === `note:${turn.contextTurnId}` || value === `note:${turn.id}` || (turn.draftId && publishedDraftIds.includes(turn.draftId))).slice().reverse();
}
