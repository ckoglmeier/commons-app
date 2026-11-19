/*
 * Presentation state for the persistent-rail Coordinator workspace (layout="persistent").
 *
 * Everything here is layout only: pane ratio, which surface is showing, and how a context choice is remembered. It stores no conversation
 * text, drafts, or artifact content, grants no permission, and every browser access is guarded with an in-memory fallback.
 */

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/* ------------------------------------------------------------------ geometry */

export type LayoutMetrics = { workMin: number; conversationMin: number; divider: number };
/** Only used until the real `--cm-workspace-*` tokens can be read (about 400px, 360px and 12px at a 16px root). */
export const FALLBACK_METRICS: LayoutMetrics = { workMin: 400, conversationMin: 360, divider: 12 };

export const DEFAULT_WORK_RATIO = 0.56;
export const RATIO_STEP = 0.02;
export const RATIO_LARGE_STEP = 0.1;
/** Stored ratios outside this range are ignored; the width bounds below are the real limits. */
const STORED_MIN = 0.2, STORED_MAX = 0.8;

/** Resolve a CSS length such as `25rem` or `400px`. Anything else is not trusted. */
export function parseCssLength(value: string | null | undefined, rootFontPx = 16): number | null {
  const match = /^\s*(-?\d*\.?\d+)(rem|px|em)?\s*$/.exec(value ?? "");
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return match[2] === "px" || !match[2] ? amount : amount * rootFontPx;
}

export function resolveMetrics(read: (name: string) => string | null | undefined, rootFontPx = 16): LayoutMetrics {
  return {
    workMin: parseCssLength(read("--cm-workspace-work-min"), rootFontPx) ?? FALLBACK_METRICS.workMin,
    conversationMin: parseCssLength(read("--cm-workspace-conversation-min"), rootFontPx) ?? FALLBACK_METRICS.conversationMin,
    divider: parseCssLength(read("--cm-workspace-divider-width"), rootFontPx) ?? FALLBACK_METRICS.divider,
  };
}

/** Work and conversation sit side by side only when the content box (not the viewport) fits both minimums and the divider. */
export function fitsSplit(width: number, metrics: LayoutMetrics = FALLBACK_METRICS) {
  return Number.isFinite(width) && width >= metrics.workMin + metrics.conversationMin + metrics.divider;
}

/** The share of the space beside the divider that Work may take. When the minimums do not fit, only the default remains. */
export function ratioBounds(width: number, metrics: LayoutMetrics = FALLBACK_METRICS): { min: number; max: number } {
  const room = width - metrics.divider;
  if (!(room > 0) || !fitsSplit(width, metrics)) return { min: DEFAULT_WORK_RATIO, max: DEFAULT_WORK_RATIO };
  return { min: metrics.workMin / room, max: 1 - metrics.conversationMin / room };
}

export function clampRatio(ratio: number, width: number, metrics: LayoutMetrics = FALLBACK_METRICS) {
  const { min, max } = ratioBounds(width, metrics);
  const value = Number.isFinite(ratio) ? ratio : DEFAULT_WORK_RATIO;
  return Math.min(max, Math.max(min, value));
}

/** A pointer position inside the layout box, as a ratio of the space beside the divider (the divider is centered on the pointer). */
export function ratioFromPointer(clientX: number, box: { left: number; width: number }, metrics: LayoutMetrics = FALLBACK_METRICS) {
  const room = box.width - metrics.divider;
  if (!(room > 0)) return DEFAULT_WORK_RATIO;
  return clampRatio((clientX - box.left - metrics.divider / 2) / room, box.width, metrics);
}

/** Keyboard resizing: arrows move the divider, Home/End reach the bounds. Returns null when the key is not a resize key. */
export function ratioForKey(key: string, current: number, bounds: { min: number; max: number }, large = false): number | null {
  const step = large ? RATIO_LARGE_STEP : RATIO_STEP;
  const clamp = (value: number) => Math.min(bounds.max, Math.max(bounds.min, value));
  if (key === "ArrowLeft" || key === "ArrowUp") return clamp(current - step);
  if (key === "ArrowRight" || key === "ArrowDown") return clamp(current + step);
  if (key === "Home") return bounds.min;
  if (key === "End") return bounds.max;
  return null;
}

/** ARIA values are whole percentages of Work. Min rounds up and max rounds down so `now` always lies between them. */
export function separatorValues(ratio: number, bounds: { min: number; max: number }) {
  const min = Math.ceil(bounds.min * 100 - 1e-9), max = Math.floor(bounds.max * 100 + 1e-9);
  const now = Math.min(Math.max(min, Math.round(ratio * 100)), Math.max(min, max));
  return { now, min, max: Math.max(min, max) };
}

export type SurfaceMode = "conversation" | "split" | "full" | "work";
/**
 * What the pane layout shows. `conversation`: Work is closed. `split`: both fit. `full`: Work expanded over the conversation.
 * `work`: Work is open but only one surface fits, so it replaces the conversation until the person goes back.
 */
export function surfaceMode(input: { workOpen: boolean; expanded: boolean; fits: boolean }): SurfaceMode {
  if (!input.workOpen) return "conversation";
  if (input.expanded) return "full";
  return input.fits ? "split" : "work";
}

/* ----------------------------------------------------------- ratio storage */

export function layoutStorageKey(slug: string, actorId: string) {
  return `commons:workspace-layout:v1:${slug}:${actorId}`;
}

const memory = new Map<string, string>();
function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function validStoredRatio(value: unknown): number | null {
  const ratio = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(ratio) && ratio >= STORED_MIN && ratio <= STORED_MAX ? ratio : null;
}

/** Without an actor there is no safe scope, so nothing is read or written. */
export function readRatio(slug: string, actorId: string | undefined, storage: StorageLike | null = browserStorage()): number {
  if (!actorId) return DEFAULT_WORK_RATIO;
  const key = layoutStorageKey(slug, actorId);
  let stored: string | null | undefined;
  try { stored = storage?.getItem(key); } catch { stored = undefined; }
  return validStoredRatio(stored ?? memory.get(key)) ?? DEFAULT_WORK_RATIO;
}

/** Writing the default removes the key. A blocked or full store falls back to memory for this page load. */
export function writeRatio(slug: string, actorId: string | undefined, ratio: number, storage: StorageLike | null = browserStorage()) {
  if (!actorId) return;
  const key = layoutStorageKey(slug, actorId);
  const value = validStoredRatio(ratio);
  const isDefault = value === null || Math.abs(value - DEFAULT_WORK_RATIO) < 0.0005;
  if (isDefault) memory.delete(key); else memory.set(key, String(Math.round((value as number) * 1000) / 1000));
  try {
    if (isDefault) storage?.removeItem(key); else storage?.setItem(key, memory.get(key)!);
  } catch { /* storage is optional; the in-memory value still applies */ }
}

/* ------------------------------------------------------------ history.state */

export const HISTORY_MEMBER = "commonsWorkspace";
export type WorkspaceSurface = "conversation" | "work" | "tasks";
export type WorkspaceHistoryMember = { v: 1; surface: WorkspaceSurface; expanded: boolean };
type HistoryLike = Pick<History, "state" | "replaceState">;

export function readWorkspaceHistory(state: unknown): WorkspaceHistoryMember | null {
  if (!state || typeof state !== "object") return null;
  const member = (state as Record<string, unknown>)[HISTORY_MEMBER];
  if (!member || typeof member !== "object") return null;
  const { v, surface, expanded } = member as Record<string, unknown>;
  if (v !== 1 || (surface !== "conversation" && surface !== "work" && surface !== "tasks") || typeof expanded !== "boolean") return null;
  return { v: 1, surface, expanded: surface === "conversation" ? false : expanded };
}

/** Merge into whatever the framework or another feature already keeps in history.state; never replaces other members. */
export function mergeWorkspaceHistory(state: unknown, member: Pick<WorkspaceHistoryMember, "surface" | "expanded">): Record<string, unknown> {
  const base = state && typeof state === "object" && !Array.isArray(state) ? state as Record<string, unknown> : {};
  return { ...base, [HISTORY_MEMBER]: { v: 1, surface: member.surface, expanded: member.surface === "conversation" ? false : member.expanded } satisfies WorkspaceHistoryMember };
}

/** Replace (never push) so a resize or toggle adds no history entry. Returns whether anything was written. */
export function persistWorkspaceHistory(member: Pick<WorkspaceHistoryMember, "surface" | "expanded">, history: HistoryLike | null = typeof window === "undefined" ? null : window.history): boolean {
  if (!history) return false;
  try {
    const current = readWorkspaceHistory(history.state);
    const next = mergeWorkspaceHistory(history.state, member);
    if (current && current.surface === (next[HISTORY_MEMBER] as WorkspaceHistoryMember).surface && current.expanded === (next[HISTORY_MEMBER] as WorkspaceHistoryMember).expanded) return false;
    history.replaceState(next, "");
    return true;
  } catch { return false; }
}

/* ------------------------------------------------------------ context scope */

export const legacyContextKey = (slug: string) => `commons-workspace-context:${slug}`;
/** Trip and actor scoped when the actor is known; otherwise the trip-only key remains. */
export const scopedContextKey = (slug: string, actorId?: string) => actorId ? `commons-workspace-context:${slug}:${actorId}` : legacyContextKey(slug);

const CONTEXT_ID = /^(?:(?:thread|draft|poll|itinerary|research|note):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|new)$/i;
/** Only a well-formed artifact ID is ever carried across keys. The reader still validates it against current authorized data. */
export function migratableContext(stored: string | null | undefined): string | null {
  return stored && CONTEXT_ID.test(stored) ? stored : null;
}
