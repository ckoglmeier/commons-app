"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import type { CoordinatorThread } from "@commons/contracts";
import { defaultWorkspaceContext, validWorkspaceContext, workspaceThreadId } from "@/lib/coordinator-workspace-context";
import { legacyContextKey, migratableContext, scopedContextKey } from "@/lib/workspace-presentation";

const memory = new Map<string, string>();
const changed = "commons-workspace-context";
function subscribe(callback: () => void) {
  window.addEventListener(changed, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(changed, callback); window.removeEventListener("storage", callback); };
}

/**
 * Store only the artifact ID, never conversation text or draft contents. The key is trip and actor scoped once the actor is known, so a remembered
 * selection never reaches another person on a shared browser. The first read migrates only a well-formed ID from the older trip-only key (never text).
 */
export function useCoordinatorContext(slug: string, thread: CoordinatorThread, initialDraftId?: string, initialPollId?:string, initialItineraryId?: string, actorId?: string) {
  const key = scopedContextKey(slug, actorId);
  const oldKey = actorId ? legacyContextKey(slug) : null;
  const fallback = defaultWorkspaceContext(thread, initialDraftId,initialPollId,initialItineraryId);
  // A linked thread must win over an older tab selection when hydrating.
  const preferInitial = useRef(Boolean(initialDraftId || initialPollId || initialItineraryId || thread.activeThreadId));
  const read = useCallback(() => {
    const researchId = new URLSearchParams(window.location.search).get("research");
    if (preferInitial.current && researchId && thread.turns.some(turn => turn.id === researchId && turn.workspace?.research)) return `research:${researchId}`;
    let stored = memory.get(key);
    try { stored ??= window.sessionStorage.getItem(key) ?? undefined; } catch { /* Storage may be blocked; in-memory switching remains available. */ }
    if (stored === undefined && oldKey) {
      let earlier = memory.get(oldKey);
      try { earlier ??= window.sessionStorage.getItem(oldKey) ?? undefined; } catch { /* Same as above. */ }
      stored = migratableContext(earlier) ?? undefined;
    }
    if (preferInitial.current && (initialDraftId || initialPollId || initialItineraryId || !stored || workspaceThreadId(stored, thread) !== thread.activeThreadId)) return validWorkspaceContext(fallback, thread);
    return validWorkspaceContext(stored ?? fallback, thread);
  }, [key, oldKey, fallback, thread, initialDraftId, initialPollId, initialItineraryId]);
  const selected = useSyncExternalStore(subscribe, read, () => validWorkspaceContext(fallback, thread));
  const select = useCallback((value: string) => {
    preferInitial.current = false;
    // A server-confirmed new draft/poll can arrive in the same React batch as
    // selection. Validate when reading against the latest thread, not here
    // against the previous render, or the requested selection is lost forever.
    memory.set(key, value);
    try { window.sessionStorage.setItem(key, value); } catch { /* Private-mode storage is optional. */ }
    window.dispatchEvent(new Event(changed));
  }, [key]);
  return [selected, select] as const;
}
