/*
 * Unsent typed text, one slot per destination, per actor and trip (sessionStorage; every access is guarded).
 *
 * Rules (docs/COORDINATOR-WORKSPACE-DESIGN.md §12 Stage 5):
 * - Text belongs to the place it was typed for. Switching to another thread shows that thread's own text; nothing moves silently.
 * - It survives voice start/end, topic switches, a refresh and error recovery.
 * - It is cleared only when the exact text is confirmed sent, and it is never used as speech context or submitted for the person.
 */

import { z } from "zod";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * A destination is where a send would go: `overview` (a draft-only entry), `new` (an ordinary new conversation), `ask` (a fresh
 * Ask the group question), or a Workspace selection such as `thread:<id>`.
 */
export type UnsentDestination = "personal" | "overview" | "new" | "ask" | `thread:${string}` | `draft:${string}` | `poll:${string}` | `note:${string}`;

const MAX_LENGTH = 30000;

function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

export function unsentKey(slug: string, actorId: string, destination: UnsentDestination) {
  return `commons:${slug}:${actorId}:coordinator-unsent:${destination}`;
}

export function readUnsent(slug: string, actorId: string, destination: UnsentDestination, storage: StorageLike | null = browserStorage()): string {
  try { return storage?.getItem(unsentKey(slug, actorId, destination)) ?? ""; } catch { return ""; }
}

/** Empty text removes the slot so storage does not accumulate blanks. */
export function writeUnsent(slug: string, actorId: string, destination: UnsentDestination, text: string, storage: StorageLike | null = browserStorage()) {
  try {
    const key = unsentKey(slug, actorId, destination);
    if (text) storage?.setItem(key, text.slice(0, MAX_LENGTH)); else storage?.removeItem(key);
  } catch { /* storage is optional; typing must never fail because it is unavailable */ }
}

/** Clears the slot only when it still holds exactly `sent`, so text typed after pressing Send is not lost. */
export function clearUnsentIfSent(slug: string, actorId: string, destination: UnsentDestination, sent: string, storage: StorageLike | null = browserStorage()) {
  if (readUnsent(slug, actorId, destination, storage) === sent) writeUnsent(slug, actorId, destination, "", storage);
}

const itineraryPasteSchema = z.object({
  source: z.string().min(1).max(MAX_LENGTH),
  destination: z.string().regex(/^(?:personal|overview|new|ask|(?:thread|draft|poll|note):[0-9a-f-]{36})$/i),
});
const itineraryPasteKey = (slug: string, actorId: string, draftId: string) => `commons:${slug}:${actorId}:itinerary-paste:${draftId}`;

/** Keep the original composer destination through refresh; this record authorizes no write. */
export function rememberItineraryPaste(slug: string, actorId: string, draftId: string, destination: UnsentDestination, source: string, storage: StorageLike | null = browserStorage()) {
  try { storage?.setItem(itineraryPasteKey(slug, actorId, draftId), JSON.stringify(itineraryPasteSchema.parse({destination, source}))); } catch { /* Mounted recovery remains available. */ }
}

/** Call only after a verified save. Newer composer text and other actors remain untouched. */
export function finishSavedItineraryPaste(slug: string, actorId: string, draftId: string, source: string | undefined, storage: StorageLike | null = browserStorage()): UnsentDestination | null {
  try {
    const key = itineraryPasteKey(slug, actorId, draftId);
    const parsed = itineraryPasteSchema.safeParse(JSON.parse(storage?.getItem(key) ?? "null"));
    if (!parsed.success || parsed.data.source !== source) return null;
    const destination = parsed.data.destination as UnsentDestination;
    clearUnsentIfSent(slug, actorId, destination, parsed.data.source, storage);
    storage?.removeItem(key);
    return destination;
  } catch { return null; }
}

/** The destination for a Workspace selection, given whether a new conversation or an Ask the group question is being started. */
export function unsentDestinationFor(view: { startingQuestion: boolean; startingThread: boolean; selected: string }, ownerThreadId?: string): UnsentDestination {
  if (view.startingQuestion) return "ask";
  if (view.startingThread || view.selected === "new") return "new";
  if (ownerThreadId) return `thread:${ownerThreadId}`;
  return view.selected as UnsentDestination;
}

/** Explicit, conflict-aware handoff. No request, send, or content in the URL. */
export function transferUnsent(slug: string, actorId: string, source: UnsentDestination, target: UnsentDestination, text: string, replace = false, storage: StorageLike | null = browserStorage()): "transferred" | "conflict" | "unavailable" {
  if (!storage) return "unavailable";
  const existing = readUnsent(slug, actorId, target, storage);
  if (text && existing && existing !== text && !replace) return "conflict";
  if (!text) return "transferred";
  // Keep the source until the destination is verified, including storage quota failures.
  writeUnsent(slug, actorId, target, text, storage);
  if (readUnsent(slug, actorId, target, storage) !== text) return "unavailable";
  clearUnsentIfSent(slug, actorId, source, text, storage);
  return "transferred";
}
