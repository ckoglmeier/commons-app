import { ZodError } from "zod";
import { ItineraryContentSchema, ItineraryDraftSchema, itineraryContentEqual, undoItineraryRevision, validateItineraryTiming, type ItineraryContent, type ItineraryDraft } from "@commons/contracts";
export type DocumentSave<C = ItineraryContent> = { commandId: string; turnId: string; threadId: string; documentId: string; expectedVersion: number; content: C };
export type DocumentValue<C> = { id: string; threadId: string; version: number; content: C };
export type VersionedDocumentState<C, D extends DocumentValue<C>> = { draft: D; turnId: string; observed?: { draft: D; turnId: string } };
export type DocumentState = VersionedDocumentState<ItineraryContent, ItineraryDraft>;
type Recovery<C, D extends DocumentValue<C>> = { base: VersionedDocumentState<C, D>; content: C; pending: DocumentSave<C> | null };
const equal = itineraryContentEqual;
function recoverTyping<C>(raw: unknown, parse: (value: unknown) => C): C {
  try { return parse(raw); } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    const normalized = structuredClone(raw) as Record<string, unknown>, originals: Array<{ path: PropertyKey[]; value: string }> = [];
    for (const issue of error.issues) {
      let target: unknown = normalized;
      for (const key of issue.path.slice(0, -1)) target = (target as Record<PropertyKey, unknown>)[key];
      const key = issue.path.at(-1)!; const value = (target as Record<PropertyKey, unknown>)[key];
      if (issue.code !== "too_small" || typeof value !== "string" || value.trim() || !/(?:title|prompt|label)$/.test(String(key))) throw error;
      originals.push({ path: issue.path, value }); (target as Record<PropertyKey, unknown>)[key] = "Recovered text";
    }
    const result = parse(normalized);
    for (const original of originals) { let target: unknown = result; for (const key of original.path.slice(0, -1)) target = (target as Record<PropertyKey, unknown>)[key]; (target as Record<PropertyKey, unknown>)[original.path.at(-1)!] = original.value; }
    return result;
  }
}

/** A single serialized save queue. A receipt acknowledges its captured text, never text typed later. */
export class VersionedDocumentAutosave<C, D extends DocumentValue<C>> {
  base: VersionedDocumentState<C, D>;
  content: C;
  pending: DocumentSave<C> | null = null;
  status: "saved" | "dirty" | "saving" | "error" | "conflict" = "saved";
  error = "";
  private active: Promise<VersionedDocumentState<C, D>> | null = null;
  private remote: VersionedDocumentState<C, D> | null = null;
  constructor(state: VersionedDocumentState<C, D>, private persist: (request: DocumentSave<C>) => Promise<VersionedDocumentState<C, D>>, private changed: () => void,
    private recovery: (value: string | null) => void, raw: string | null | undefined, private checks: { content: (raw: unknown) => C; draft: (raw: unknown) => D; undo: (current: C, before: C, after: C) => C; validateBeforeSave?: (content: C) => void }) {
    this.base = state; this.content = state.draft.content;
    if (raw) {
      try {
        const stored = JSON.parse(raw) as Recovery<C, D>;
        const base = checks.draft(stored.base.draft), content = recoverTyping(stored.content, checks.content);
        if (base.id !== state.draft.id || base.threadId !== state.draft.threadId || !/^[0-9a-f-]{36}$/i.test(stored.base.turnId)) return;
        this.content = content;
        this.base = { draft: base, turnId: stored.base.turnId };
        if (stored.pending && stored.pending.documentId === base.id && stored.pending.threadId === base.threadId && stored.pending.expectedVersion === base.version && stored.pending.turnId === stored.base.turnId && /^[0-9a-f-]{36}$/i.test(stored.pending.commandId)) {
          const pending = { ...stored.pending, content: checks.content(stored.pending.content) };
          try {
            // Only discard a recovered payload that authoritative server validation
            // could never commit. Valid uncertain requests keep their replay identity.
            checks.validateBeforeSave?.(pending.content);
            this.pending = pending;
          } catch { /* Preserve local typing, without replaying a known-invalid payload. */ }
        }
        this.receive(state, false);
        if (this.status !== "conflict") this.status = this.dirty ? "dirty" : "saved";
      } catch { /* Keep the server document when recovery is malformed. */ }
    }
  }
  get dirty() { return Boolean(this.pending) || !equal(this.content, this.base.draft.content); }
  private notify() {
    this.recovery(this.dirty ? JSON.stringify({ base: this.base, content: this.content, pending: this.pending } satisfies Recovery<C, D>) : null);
    this.changed();
  }
  edit(content: C) {
    this.content = content;
    if (this.status !== "conflict" && (this.status !== "error" || !this.pending) && this.status !== "saving") this.status = this.dirty ? "dirty" : "saved";
    this.notify();
  }
  receive(state: VersionedDocumentState<C, D>, notify = true) {
    if (state.draft.id !== this.base.draft.id || state.draft.version < this.base.draft.version) return;
    if (state.draft.version === this.base.draft.version && equal(state.draft.content, this.base.draft.content)) return;
    if (this.pending && state.draft.version === this.pending.expectedVersion + 1 && equal(state.draft.content, this.pending.content)) {
      this.base = state; this.pending = null;
      this.status = this.dirty ? "dirty" : "saved";
    } else if (!this.dirty) { this.base = state; this.content = state.draft.content; this.status = "saved"; }
    else { this.remote = state; this.status = "conflict"; this.error = "This document changed elsewhere. Your edits are still here. Compare the saved version before retrying."; }
    if (notify) this.notify();
  }
  reconcile() {
    if (!this.remote || this.active) throw new Error("Wait for the pending save before reconciling.");
    // Apply only local fields whose current values still equal our old base.
    const merged = this.checks.undo(this.remote.draft.content, this.content, this.base.draft.content);
    this.base = this.remote; this.remote = null; this.pending = null; this.content = merged;
    this.error = ""; this.status = this.dirty ? "dirty" : "saved"; this.notify();
  }
  get savedElsewhere() { return this.remote; }
  flush(): Promise<VersionedDocumentState<C, D>> {
    if (this.active) return this.active;
    if (this.status === "conflict") return Promise.reject(new Error(this.error));
    const run = async () => {
      while (this.dirty) {
        if (this.status === "conflict") throw new Error(this.error);
        if (!this.pending) {
          const parsed = this.checks.content(this.content);
          this.checks.validateBeforeSave?.(parsed);
          this.content = parsed;
        }
        this.pending ??= { commandId: crypto.randomUUID(), turnId: this.base.turnId, threadId: this.base.draft.threadId, documentId: this.base.draft.id, expectedVersion: this.base.draft.version, content: structuredClone(this.content) };
        const request = this.pending;
        this.checks.content(request.content);
        this.status = "saving"; this.error = ""; this.notify();
        const saved = await this.persist(request);
        if (saved.draft.id !== request.documentId || saved.draft.version !== request.expectedVersion + 1 || !equal(saved.draft.content, this.checks.content(request.content))) throw new Error("The saved document could not be verified. Your edits are still here.");
        if (this.remote) throw new Error(this.error);
        this.base = { draft: saved.draft, turnId: saved.turnId }; this.pending = null;
        if (saved.observed && saved.observed.draft.version > saved.draft.version) this.receive(saved.observed, false);
        if (this.remote) throw new Error(this.error);
        this.status = this.dirty ? "dirty" : "saved"; this.notify();
      }
      return this.base;
    };
    this.active = run().catch(error => {
      if (this.status !== "conflict") this.status = "error";
      this.error = error instanceof ZodError ? "Finish the empty title, day heading or question before saving. Your text is still here." : error instanceof Error ? error.message : "The save was not confirmed. Your edits are still here.";
      this.notify(); throw error;
    }).finally(() => { this.active = null; });
    return this.active;
  }
}

export class ItineraryDocumentAutosave extends VersionedDocumentAutosave<ItineraryContent, ItineraryDraft> {
  constructor(state: DocumentState, persist: (request: DocumentSave) => Promise<DocumentState>, changed: () => void, recovery: (value: string | null) => void, raw?: string | null) {
    super(state, persist, changed, recovery, raw, { content: raw => ItineraryContentSchema.parse(raw), draft: raw => ItineraryDraftSchema.parse(raw), undo: undoItineraryRevision, validateBeforeSave: validateItineraryTiming });
  }
}
