import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { TripPlanningContextStateSchema } from "@commons/contracts";
import { createHookRenderer, textOf } from "../lib/test-support/hook-harness";
import { TripContextEditor } from "./trip-context-editor";

const initial = TripPlanningContextStateSchema.parse({ tripId: "11111111-1111-4111-8111-111111111111", viewerId: "22222222-2222-4222-8222-222222222222", name: "Weekend", version: 0, updatedAt: null, updatedByName: null, brief: {} });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
test("context drafts survive reload and uncertain saves retry the same command without premature success", async () => {
  const originals = ["window", "sessionStorage", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const storage = new Map<string, string>(); let fail = true; const calls: Array<{ commandId: string; expectedVersion: number; brief: typeof initial.brief }> = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout } });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  globalThis.fetch = async (_url, options) => { const command = JSON.parse(String(options?.body)); calls.push(command); if (fail) throw new Error("Connection interrupted"); return Response.json({ ...initial, version: 1, updatedAt: "2026-10-04T12:00:00.000Z", updatedByName: "Organizer", brief: command.brief }); };
  let renderer = createHookRenderer({ expand: [TripContextEditor] });
  const mount = async () => { renderer.render(createElement(TripContextEditor, { initial })); await tick(); renderer.flush(); };
  const submit = async () => { (renderer.find(node => node.type === "form").props.onSubmit as (event: object) => void)({ preventDefault() {} }); await tick(); renderer.flush(); };
  try {
    await mount();
    const input = renderer.find(node => node.type === "input" && node.props.maxLength === 160);
    (input.props.onChange as (event: object) => void)({ target: { value: "Slow mornings" } }); renderer.flush();
    renderer.unmount(); renderer = createHookRenderer({ expand: [TripContextEditor] }); await mount();
    assert.equal(renderer.find(node => node.type === "input" && node.props.maxLength === 160).props.value, "Slow mornings");
    await submit(); assert.doesNotMatch(renderer.tree.map(textOf).join(" "), /Trip context saved\./); assert.equal(calls.length, 1);
    renderer.unmount(); renderer = createHookRenderer({ expand: [TripContextEditor] }); await mount();
    assert.match(renderer.tree.map(textOf).join(" "), /Retry save/);
    fail = false; await submit(); assert.equal(calls[1].commandId, calls[0].commandId); assert.equal(calls[1].brief.pace, "Slow mornings");
    assert.match(renderer.tree.map(textOf).join(" "), /Trip context saved\./); assert.equal(storage.size, 0);
  } finally { renderer.unmount(); for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});
