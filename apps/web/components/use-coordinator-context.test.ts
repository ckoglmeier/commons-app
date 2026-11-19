import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { CoordinatorThread } from "@commons/contracts";
import { createHookRenderer, registerComponentImportStubs } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment } from "../lib/test-support/fake-live-transport";

registerComponentImportStubs();

const goal = "123e4567-e89b-42d3-a456-426614174001", other = "123e4567-e89b-42d3-a456-426614174002";
const thread = { version: 1, turns: [], drafts: [], polls: [], threads: [{ id: goal, status: "active" }, { id: other, status: "active" }] } as unknown as CoordinatorThread;

async function mount(slug: string, actorId: string | undefined) {
  const { useCoordinatorContext } = await import("./use-coordinator-context");
  let select: (value: string) => void = () => {};
  function Probe() {
    const [selected, choose] = useCoordinatorContext(slug, thread, undefined, undefined, undefined, actorId);
    select = choose;
    return createElement("div", { "data-selected": selected });
  }
  const renderer = createHookRenderer({ expand: [Probe] });
  renderer.render(createElement(Probe));
  renderer.flush();
  return { selected: () => String(renderer.find(node => node.type === "div").props["data-selected"]), choose: (value: string) => { select(value); renderer.render(createElement(Probe)); renderer.flush(); } };
}

test("a remembered selection is trip and actor scoped, so another person on the same browser never inherits it", async () => {
  const env = installFakeLiveEnvironment();
  try {
    const first = await mount("trip-scope", "actor-a");
    first.choose(`thread:${other}`);
    assert.equal(first.selected(), `thread:${other}`);
    assert.equal(window.sessionStorage.getItem("commons-workspace-context:trip-scope:actor-a"), `thread:${other}`);
    assert.equal(window.sessionStorage.getItem("commons-workspace-context:trip-scope"), null, "the trip-only key is not written for a known actor");
    const second = await mount("trip-scope", "actor-b");
    assert.notEqual(second.selected(), `thread:${other}`, "actor-b starts from its own default");
    assert.equal(window.sessionStorage.getItem("commons-workspace-context:trip-scope:actor-b"), null);
  } finally { env.restore(); }
});

test("only a well-formed ID is migrated from the old trip-only key, and it is still validated against current data", async () => {
  const env = installFakeLiveEnvironment();
  try {
    window.sessionStorage.setItem("commons-workspace-context:trip-migrate", `thread:${other}`);
    const migrated = await mount("trip-migrate", "actor-a");
    assert.equal(migrated.selected(), `thread:${other}`, "a valid stored ID carries over once the actor is known");
    assert.equal(window.sessionStorage.getItem("commons-workspace-context:trip-migrate"), `thread:${other}`, "the old key stays for the flag-off layout");

    window.sessionStorage.setItem("commons-workspace-context:trip-text", "thread:Where should we eat on Saturday around 5?");
    const text = await mount("trip-text", "actor-a");
    assert.notEqual(text.selected(), "thread:Where should we eat on Saturday around 5?", "text is never copied between keys");
    assert.equal(window.sessionStorage.getItem("commons-workspace-context:trip-text:actor-a"), null);

    window.sessionStorage.setItem("commons-workspace-context:trip-stale", "thread:123e4567-e89b-42d3-a456-426614174999");
    const stale = await mount("trip-stale", "actor-a");
    assert.equal(stale.selected(), `thread:${goal}`, "an ID that is no longer an authorized active conversation falls back");
  } finally { env.restore(); }
});

test("without an actor the trip-only key keeps working exactly as before", async () => {
  const env = installFakeLiveEnvironment();
  try {
    const anonymous = await mount("trip-anon", undefined);
    anonymous.choose(`thread:${other}`);
    assert.equal(window.sessionStorage.getItem("commons-workspace-context:trip-anon"), `thread:${other}`);
  } finally { env.restore(); }
});
