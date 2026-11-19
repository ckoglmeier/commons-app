import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WORK_RATIO, FALLBACK_METRICS, HISTORY_MEMBER, clampRatio, fitsSplit, layoutStorageKey, legacyContextKey, mergeWorkspaceHistory, migratableContext, parseCssLength,
  persistWorkspaceHistory, ratioBounds, ratioForKey, ratioFromPointer, readRatio, readWorkspaceHistory, resolveMetrics, scopedContextKey, separatorValues, surfaceMode, validStoredRatio, writeRatio,
} from "./workspace-presentation";

const metrics = { workMin: 400, conversationMin: 360, divider: 12 };

test("split fits only when the container holds both minimums and the divider", () => {
  assert.equal(fitsSplit(771, metrics), false);
  assert.equal(fitsSplit(772, metrics), true);
  assert.equal(fitsSplit(Number.NaN, metrics), false);
  assert.equal(fitsSplit(0, metrics), false);
});

test("surface mode: closed Work is conversation; expanded wins; otherwise measured fit decides", () => {
  assert.equal(surfaceMode({ workOpen: false, expanded: true, fits: true }), "conversation");
  assert.equal(surfaceMode({ workOpen: true, expanded: true, fits: false }), "full");
  assert.equal(surfaceMode({ workOpen: true, expanded: false, fits: true }), "split");
  assert.equal(surfaceMode({ workOpen: true, expanded: false, fits: false }), "work");
});

test("ratio bounds keep both minimum widths; a container that cannot split offers only the default", () => {
  const width = 1012; // 1000px beside the 12px divider
  const { min, max } = ratioBounds(width, metrics);
  assert.ok(Math.abs(min - 0.4) < 1e-9);
  assert.ok(Math.abs(max - 0.64) < 1e-9);
  assert.equal(clampRatio(0.1, width, metrics), min);
  assert.equal(clampRatio(0.99, width, metrics), max);
  assert.equal(clampRatio(0.5, width, metrics), 0.5);
  assert.equal(clampRatio(Number.NaN, width, metrics), DEFAULT_WORK_RATIO);
  assert.deepEqual(ratioBounds(600, metrics), { min: DEFAULT_WORK_RATIO, max: DEFAULT_WORK_RATIO });
  assert.equal(clampRatio(0.3, 600, metrics), DEFAULT_WORK_RATIO);
});

test("at the narrowest width that splits, the default share is squeezed to exactly both minimums", () => {
  const width = metrics.workMin + metrics.conversationMin + metrics.divider; // 772: 400 + 360 beside the divider
  const { min, max } = ratioBounds(width, metrics);
  assert.ok(Math.abs(min - max) < 1e-9);
  const clamped = clampRatio(DEFAULT_WORK_RATIO, width, metrics);
  assert.ok(Math.abs(clamped * (width - metrics.divider) - metrics.workMin) < 1e-6);
});

test("pointer position centers the divider and is clamped", () => {
  const box = { left: 100, width: 1012 };
  // pointer 506px (+ half divider) from the left edge of the box is half of the 1000px beside the divider
  assert.ok(Math.abs(ratioFromPointer(100 + 6 + 500, box, metrics) - 0.5) < 1e-9);
  assert.equal(ratioFromPointer(0, box, metrics), ratioBounds(box.width, metrics).min);
  assert.equal(ratioFromPointer(5000, box, metrics), ratioBounds(box.width, metrics).max);
});

test("separator keyboard math: arrows step, shift steps further, Home and End reach the bounds, other keys are ignored", () => {
  const bounds = { min: 0.4, max: 0.64 };
  assert.ok(Math.abs((ratioForKey("ArrowRight", 0.5, bounds) as number) - 0.52) < 1e-9);
  assert.ok(Math.abs((ratioForKey("ArrowLeft", 0.5, bounds) as number) - 0.48) < 1e-9);
  assert.ok(Math.abs((ratioForKey("ArrowRight", 0.5, bounds, true) as number) - 0.6) < 1e-9);
  assert.equal(ratioForKey("ArrowLeft", 0.41, bounds), 0.4, "never below the minimum");
  assert.equal(ratioForKey("ArrowRight", 0.63, bounds, true), 0.64, "never above the maximum");
  assert.equal(ratioForKey("Home", 0.5, bounds), 0.4);
  assert.equal(ratioForKey("End", 0.5, bounds), 0.64);
  assert.equal(ratioForKey("Enter", 0.5, bounds), null);
  assert.equal(ratioForKey("a", 0.5, bounds), null);
});

test("separator ARIA values are whole percentages with now between min and max", () => {
  assert.deepEqual(separatorValues(0.56, { min: 0.4, max: 0.64 }), { now: 56, min: 40, max: 64 });
  // 0.3989 rounds up to 40 and 0.6401 rounds down to 64, so the pair never claims a width the bounds forbid
  assert.deepEqual(separatorValues(0.4, { min: 0.3989, max: 0.6401 }), { now: 40, min: 40, max: 64 });
  const awkward = separatorValues(0.5, { min: 0.56, max: 0.56 });
  assert.ok(awkward.now >= awkward.min && awkward.now <= awkward.max);
});

test("CSS lengths from the shared tokens resolve against the root font size", () => {
  assert.equal(parseCssLength("25rem", 16), 400);
  assert.equal(parseCssLength(" 0.75rem ", 20), 15);
  assert.equal(parseCssLength("360px"), 360);
  assert.equal(parseCssLength("calc(1px + 2px)"), null);
  assert.equal(parseCssLength(""), null);
  assert.equal(parseCssLength(undefined), null);
  const tokens: Record<string, string> = { "--cm-workspace-work-min": "25rem", "--cm-workspace-conversation-min": "22.5rem", "--cm-workspace-divider-width": "0.75rem" };
  assert.deepEqual(resolveMetrics(name => tokens[name], 16), { workMin: 400, conversationMin: 360, divider: 12 });
  assert.deepEqual(resolveMetrics(() => "", 16), FALLBACK_METRICS, "unreadable tokens fall back instead of breaking layout");
});

class MemoryStore implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("blocked"); } };

test("ratio storage is versioned, trip and actor scoped, validated, and holds no content", () => {
  assert.equal(layoutStorageKey("trip-1", "actor-1"), "commons:workspace-layout:v1:trip-1:actor-1");
  const store = new MemoryStore();
  writeRatio("trip-1", "actor-1", 0.47, store);
  assert.equal(store.data.get("commons:workspace-layout:v1:trip-1:actor-1"), "0.47");
  assert.equal(readRatio("trip-1", "actor-1", store), 0.47);
  assert.equal(readRatio("trip-1", "actor-2", store), DEFAULT_WORK_RATIO, "another actor never reads it");
  assert.equal(readRatio("trip-2", "actor-1", store), DEFAULT_WORK_RATIO, "another trip never reads it");
  store.data.set(layoutStorageKey("trip-1", "actor-3"), "banana");
  assert.equal(readRatio("trip-1", "actor-3", store), DEFAULT_WORK_RATIO);
  store.data.set(layoutStorageKey("trip-1", "actor-3"), "5");
  assert.equal(readRatio("trip-1", "actor-3", store), DEFAULT_WORK_RATIO, "out of range is ignored");
  assert.equal(validStoredRatio("0.5"), 0.5);
  assert.equal(validStoredRatio(null), null);
});

test("writing the default clears the key; no actor means nothing is stored", () => {
  const store = new MemoryStore();
  writeRatio("trip-9", "actor-9", 0.4, store);
  assert.equal(store.data.size, 1);
  writeRatio("trip-9", "actor-9", DEFAULT_WORK_RATIO, store);
  assert.equal(store.data.size, 0);
  writeRatio("trip-9", undefined, 0.4, store);
  assert.equal(store.data.size, 0);
  assert.equal(readRatio("trip-9", undefined, store), DEFAULT_WORK_RATIO);
});

test("storage failure falls back to memory without throwing", () => {
  writeRatio("trip-blocked", "actor-1", 0.45, blocked);
  assert.equal(readRatio("trip-blocked", "actor-1", blocked), 0.45, "the in-memory value still applies for this page load");
  assert.doesNotThrow(() => writeRatio("trip-blocked", "actor-1", DEFAULT_WORK_RATIO, blocked));
  assert.equal(readRatio("trip-blocked", "actor-1", blocked), DEFAULT_WORK_RATIO);
  assert.equal(readRatio("trip-none", "actor-1", null), DEFAULT_WORK_RATIO);
});

test("history.state merge preserves every other field and only owns its namespaced member", () => {
  const framework = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: [1, 2], other: { keep: "me" } };
  const merged = mergeWorkspaceHistory(framework, { surface: "work", expanded: true });
  assert.deepEqual(merged, { ...framework, [HISTORY_MEMBER]: { v: 1, surface: "work", expanded: true } });
  assert.equal(Object.hasOwn(framework, HISTORY_MEMBER), false, "the input is not mutated");
  assert.deepEqual(mergeWorkspaceHistory(null, { surface: "tasks", expanded: false }), { [HISTORY_MEMBER]: { v: 1, surface: "tasks", expanded: false } });
  assert.deepEqual(mergeWorkspaceHistory("not an object", { surface: "conversation", expanded: true }), { [HISTORY_MEMBER]: { v: 1, surface: "conversation", expanded: false } }, "closed Work is never expanded");
  assert.deepEqual(readWorkspaceHistory(merged), { v: 1, surface: "work", expanded: true });
  assert.equal(readWorkspaceHistory({ [HISTORY_MEMBER]: { v: 2, surface: "work", expanded: true } }), null);
  assert.equal(readWorkspaceHistory({ [HISTORY_MEMBER]: { v: 1, surface: "sidebar", expanded: false } }), null);
  assert.equal(readWorkspaceHistory(undefined), null);
});

test("persisting presentation replaces history state, preserves fields, and skips unchanged writes", () => {
  const calls: Array<{ state: unknown; url: unknown }> = [];
  const history = { state: { __NA: true } as unknown, replaceState(state: unknown, _title: string, url?: unknown) { calls.push({ state, url }); this.state = state; } };
  assert.equal(persistWorkspaceHistory({ surface: "work", expanded: false }, history), true);
  assert.deepEqual(history.state, { __NA: true, [HISTORY_MEMBER]: { v: 1, surface: "work", expanded: false } });
  assert.equal(calls[0].url, undefined, "the URL is untouched, so no navigation entry is created");
  assert.equal(persistWorkspaceHistory({ surface: "work", expanded: false }, history), false, "no redundant write");
  assert.equal(persistWorkspaceHistory({ surface: "work", expanded: true }, history), true);
  assert.equal(calls.length, 2);
  assert.equal(persistWorkspaceHistory({ surface: "work", expanded: true }, { get state(): unknown { throw new Error("blocked"); }, replaceState() {} }), false);
  assert.equal(persistWorkspaceHistory({ surface: "work", expanded: true }, null), false);
});

test("context selection is actor scoped; only a well-formed ID migrates from the trip-only key", () => {
  assert.equal(scopedContextKey("trip-1", "actor-1"), "commons-workspace-context:trip-1:actor-1");
  assert.equal(scopedContextKey("trip-1"), "commons-workspace-context:trip-1");
  assert.equal(legacyContextKey("trip-1"), "commons-workspace-context:trip-1");
  const id = "123e4567-e89b-42d3-a456-426614174000";
  for (const kind of ["thread", "draft", "poll", "itinerary", "research", "note"]) assert.equal(migratableContext(`${kind}:${id}`), `${kind}:${id}`);
  assert.equal(migratableContext("new"), "new");
  assert.equal(migratableContext("thread:Where should we eat on Saturday around 5?"), null, "text is never copied between keys");
  assert.equal(migratableContext("thread:not-a-uuid"), null);
  assert.equal(migratableContext(`thread:${id}\nextra`), null);
  assert.equal(migratableContext("overview"), null);
  assert.equal(migratableContext(undefined), null);
});
