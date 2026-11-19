/**
 * Test-only, dependency-free hook renderer for behavioral tests of client
 * components under `node --test`. It runs the real component functions with a
 * minimal hooks dispatcher (state, refs, effects, callbacks, context, ids,
 * external stores). It does not create DOM nodes: host elements stay plain
 * objects so tests can find buttons/inputs and call their handlers.
 *
 * Limits (intentional): no Suspense, no class components, no portals; function
 * components render only when listed in `expand` (others stay opaque so
 * framework components such as next/link are not executed).
 */
import * as React from "react";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

type Deps = readonly unknown[] | undefined;
type Slot =
  | { kind: "state"; value: unknown; set: (next: unknown) => void }
  | { kind: "ref"; ref: { current: unknown } }
  | { kind: "memo"; value: unknown; deps: Deps }
  | { kind: "effect"; deps: Deps; cleanup?: (() => void) | void; layout: boolean }
  | { kind: "id"; value: string };

type Instance = { slots: Slot[]; seen: boolean };
export type HostNode = { type: string; props: Record<string, unknown>; children: RenderedNode[] };
export type OpaqueNode = { type: unknown; props: Record<string, unknown>; children: RenderedNode[]; opaque: true };
export type RenderedNode = HostNode | OpaqueNode | string;

type Internals = { H: unknown };
const internals = (React as unknown as { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: Internals })
  .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

function depsChanged(previous: Deps, next: Deps) {
  if (!previous || !next) return true;
  return previous.length !== next.length || previous.some((value, index) => !Object.is(value, next[index]));
}

type RegisterHooks = (hooks: { resolve: (specifier: string, context: unknown, next: (specifier: string, context: unknown) => unknown) => unknown }) => void;
let stubsRegistered = false;
/** Lets node import client components that import CSS, `server-only` or `next/image`. Call before dynamic import. */
export function registerComponentImportStubs() {
  if (stubsRegistered) return;
  const registerHooks = (nodeModule as unknown as { registerHooks?: RegisterHooks }).registerHooks;
  if (!registerHooks) throw new Error("node:module registerHooks is required (Node 23.5+).");
  // A real file (not a data: URL) so both ESM and tsx's CommonJS transform can load it.
  const stub = pathToFileURL(join(__dirname, "empty-module.cjs")).href;
  const image = pathToFileURL(join(__dirname, "image-module.cjs")).href;
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "server-only" || specifier.endsWith(".css")) return { url: stub, format: "commonjs", shortCircuit: true };
      // next/image reads `document` when imported; components render it as an opaque node, so a null component is enough.
      if (specifier === "next/image") return { url: image, format: "commonjs", shortCircuit: true };
      return next(specifier, context);
    },
  });
  stubsRegistered = true;
}

export function createHookRenderer(options: { expand: ReadonlyArray<(...args: never[]) => unknown>; context?: (context: unknown) => unknown }) {
  const instances = new Map<string, Instance>();
  const pendingEffects: Array<{ slot: Extract<Slot, { kind: "effect" }>; run: () => (() => void) | void }> = [];
  let current: Instance | null = null;
  let index = 0;
  let idCounter = 0;
  let root: React.ReactElement | null = null;
  let tree: RenderedNode[] = [];
  let dirty = false;

  function slot<T extends Slot>(create: () => T): T {
    if (!current) throw new Error("Hook called outside a harness render.");
    const existing = current.slots[index];
    const value = (existing ?? (current.slots[index] = create())) as T;
    index += 1;
    return value;
  }
  function effect(layout: boolean) {
    return (run: () => (() => void) | void, deps?: Deps) => {
      const state = slot(() => ({ kind: "effect", deps: undefined, cleanup: undefined, layout, fresh: true }) as Extract<Slot, { kind: "effect" }> & { fresh?: boolean });
      const fresh = (state as { fresh?: boolean }).fresh;
      if (fresh || depsChanged(state.deps, deps)) {
        (state as { fresh?: boolean }).fresh = false;
        state.deps = deps;
        pendingEffects.push({ slot: state, run });
      }
    };
  }
  const dispatcher = {
    useState(initial: unknown) {
      const state = slot(() => {
        const created = { kind: "state", value: typeof initial === "function" ? (initial as () => unknown)() : initial } as Extract<Slot, { kind: "state" }>;
        created.set = (next: unknown) => {
          const value = typeof next === "function" ? (next as (value: unknown) => unknown)(created.value) : next;
          if (!Object.is(value, created.value)) { created.value = value; dirty = true; }
        };
        return created;
      });
      return [state.value, state.set];
    },
    useReducer(reducer: (state: unknown, action: unknown) => unknown, initial: unknown) {
      const state = slot(() => {
        const created = { kind: "state", value: initial } as Extract<Slot, { kind: "state" }>;
        created.set = (action: unknown) => { const value = reducer(created.value, action); if (!Object.is(value, created.value)) { created.value = value; dirty = true; } };
        return created;
      });
      return [state.value, state.set];
    },
    useRef(initial: unknown) { return slot(() => ({ kind: "ref", ref: { current: initial } })).ref; },
    useMemo(create: () => unknown, deps: Deps) {
      const memo = slot(() => ({ kind: "memo", value: create(), deps }) as Extract<Slot, { kind: "memo" }>);
      if (depsChanged(memo.deps, deps)) { memo.value = create(); memo.deps = deps; }
      return memo.value;
    },
    useCallback(callback: unknown, deps: Deps) {
      const memo = slot(() => ({ kind: "memo", value: callback, deps }) as Extract<Slot, { kind: "memo" }>);
      if (depsChanged(memo.deps, deps)) { memo.value = callback; memo.deps = deps; }
      return memo.value;
    },
    useEffect: effect(false),
    useLayoutEffect: effect(true),
    useInsertionEffect: effect(true),
    useContext(context: unknown) {
      if (options.context) { const value = options.context(context); if (value !== undefined) return value; }
      return (context as { _currentValue?: unknown })._currentValue;
    },
    useId() { return slot(() => ({ kind: "id", value: `:h${idCounter += 1}:` }) as Extract<Slot, { kind: "id" }>).value; },
    useSyncExternalStore(_subscribe: unknown, getSnapshot: () => unknown) { return getSnapshot(); },
    useDebugValue() {},
    useTransition() { return [false, (callback: () => void) => callback()]; },
    useDeferredValue(value: unknown) { return value; },
  };

  function visit(node: unknown, path: string): RenderedNode[] {
    if (node === null || node === undefined || typeof node === "boolean") return [];
    if (typeof node === "string" || typeof node === "number") return [String(node)];
    if (Array.isArray(node)) return node.flatMap((child, position) => visit(child, `${path}.${position}`));
    const element = node as React.ReactElement<Record<string, unknown>> & { key?: string | null };
    const key = element.key ?? "";
    const props = (element.props ?? {}) as Record<string, unknown>;
    if (element.type === React.Fragment) return visit(props.children, `${path}/#${key}`);
    if (typeof element.type === "string") {
      return [{ type: element.type, props, children: visit(props.children, `${path}/${element.type}#${key}`) }];
    }
    if (typeof element.type === "function" && options.expand.includes(element.type as never)) {
      const name = (element.type as { name?: string }).name ?? "Anonymous";
      const id = `${path}/${name}#${key}`;
      const instance = instances.get(id) ?? { slots: [], seen: true };
      instance.seen = true;
      instances.set(id, instance);
      const previous = internals.H, previousInstance = current, previousIndex = index;
      internals.H = dispatcher; current = instance; index = 0;
      let output: unknown;
      try { output = (element.type as (props: unknown) => unknown)(props); } finally { internals.H = previous; current = previousInstance; index = previousIndex; }
      return visit(output, id);
    }
    return [{ type: element.type, props, children: visit(props.children, `${path}/opaque#${key}`), opaque: true }];
  }

  function runEffects() {
    const effects = pendingEffects.splice(0).sort((a, b) => Number(b.slot.layout) - Number(a.slot.layout));
    for (const { slot: state, run } of effects) {
      if (typeof state.cleanup === "function") state.cleanup();
      state.cleanup = run();
    }
  }

  function renderPass() {
    if (!root) throw new Error("Nothing rendered.");
    for (const instance of instances.values()) instance.seen = false;
    dirty = false;
    tree = visit(root, "root");
    for (const [id, instance] of instances) {
      if (instance.seen) continue;
      for (const state of instance.slots) if (state.kind === "effect" && typeof state.cleanup === "function") state.cleanup();
      instances.delete(id);
    }
    runEffects();
  }

  const renderer = {
    render(element: React.ReactElement) { root = element; renderPass(); return renderer; },
    /** Re-render while state is dirty (bounded), like React committing queued updates. */
    flush() { for (let pass = 0; dirty && pass < 25; pass += 1) renderPass(); if (dirty) throw new Error("Render loop did not settle."); return renderer; },
    unmount() {
      for (const instance of instances.values()) for (const state of instance.slots) if (state.kind === "effect" && typeof state.cleanup === "function") state.cleanup();
      instances.clear(); root = null; tree = [];
    },
    get tree() { return tree; },
    get dirty() { return dirty; },
    findAll(predicate: (node: HostNode | OpaqueNode) => boolean) {
      const found: Array<HostNode | OpaqueNode> = [];
      const walk = (nodes: RenderedNode[]) => { for (const node of nodes) { if (typeof node === "string") continue; if (predicate(node)) found.push(node); walk(node.children); } };
      walk(tree);
      return found;
    },
    find(predicate: (node: HostNode | OpaqueNode) => boolean) {
      const [first] = renderer.findAll(predicate);
      if (!first) throw new Error("No rendered node matched.");
      return first;
    },
  };
  return renderer;
}

export function textOf(node: RenderedNode): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}
