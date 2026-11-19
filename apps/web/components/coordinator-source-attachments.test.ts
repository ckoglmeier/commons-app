import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { CoordinatorSourceAttachments } from "./coordinator-source-attachments";
import { createHookRenderer, textOf } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "../lib/test-support/fake-live-transport";
import type { TurnCommand } from "@commons/contracts";

const props = { slug: "synthetic", actorId: "organizer", destination: "new", disabled: false };
const key = "commons:synthetic:organizer:sources:new";
function upload(renderer: ReturnType<typeof createHookRenderer>, name = "trip.md") {
  (renderer.find(n => n.type === "input").props.onChange as (e: unknown) => void)({ target: { files: [new File(["# Thursday\nDinner"], name)], value: name } });
}
function click(renderer: ReturnType<typeof createHookRenderer>, label: string) {
  (renderer.find(n => n.type === "button" && (textOf(n) === label || n.props["aria-label"] === label)).props.onClick as () => void)(); renderer.flush();
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test("ready sources restore by actor/trip/destination; raw text is not stored; removed refs stay excluded", async () => {
  const live = installFakeLiveEnvironment(), original = globalThis.fetch, urls: string[] = [];
  let refs: NonNullable<TurnCommand["attachments"]> = [], blocked = true;
  const onChange = (next: typeof refs, busy: boolean) => { refs = next; blocked = busy; };
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    if (init?.method === "DELETE") return response({ removed: true });
    const id = init?.method === "POST" ? (init.body as FormData).get("id") : new URL(String(url), "http://localhost").searchParams.get("id");
    return response({ source: { id, digest: "a".repeat(64), filename: "trip.md", text: "PRIVATE_SOURCE_CANARY", limitations: ["Unverified"] } });
  };
  let renderer = createHookRenderer({ expand: [CoordinatorSourceAttachments] });
  try {
    renderer.render(createElement(CoordinatorSourceAttachments, { ...props, onChange })); await settle(5); renderer.flush();
    upload(renderer); await settle(5); renderer.flush();
    assert.equal(blocked, false); assert.equal(refs.length, 1);
    assert.match(renderer.tree.map(textOf).join(" "), /PRIVATE_SOURCE_CANARY/);
    assert.ok(!window.sessionStorage.getItem(key)?.includes("PRIVATE_SOURCE_CANARY"));
    renderer.unmount(); renderer = createHookRenderer({ expand: [CoordinatorSourceAttachments] });
    renderer.render(createElement(CoordinatorSourceAttachments, { ...props, onChange })); await settle(5); renderer.flush(); await settle(5); renderer.flush();
    assert.equal(refs.length, 1); assert.ok(urls.some(url => url.includes("&scope=new")));
    click(renderer, "Remove trip.md"); assert.deepEqual(refs, []);
    assert.deepEqual(JSON.parse(window.sessionStorage.getItem(key)!), []);
    renderer.render(createElement(CoordinatorSourceAttachments, { ...props, actorId: "other", key: "other", onChange })); await settle(5); renderer.flush();
    assert.deepEqual(refs, []);
  } finally { renderer.unmount(); globalThis.fetch = original; live.restore(); }
});

test("late upload results cannot survive removal or follow a destination change; rapid uploads reserve only three slots", async () => {
  const live = installFakeLiveEnvironment(), original = globalThis.fetch;
  const pending: Array<{ id: string; resolve: (response: Response) => void; signal?: AbortSignal | null }> = [];
  const cancellations: string[] = [];
  globalThis.fetch = async (url, init) => {
    if (init?.method === "DELETE") { cancellations.push(new URL(String(url), "http://localhost").searchParams.get("id")!); return response({removed:true}); }
    return new Promise(resolve => pending.push({ id: String((init!.body as FormData).get("id")), resolve, signal: init?.signal }));
  };
  let refs: NonNullable<TurnCommand["attachments"]> = [];
  const onChange = (next: typeof refs) => { refs = next; };
  const renderer = createHookRenderer({ expand: [CoordinatorSourceAttachments] });
  try {
    renderer.render(createElement(CoordinatorSourceAttachments, { ...props, key: "new", onChange })); await settle(5); renderer.flush();
    for (let i = 0; i < 4; i++) upload(renderer, `trip-${i}.md`);
    renderer.flush(); assert.equal(pending.length, 3);
    click(renderer, "Remove trip-0.md"); assert.equal(pending[0].signal?.aborted, true);
    assert.deepEqual(cancellations, [pending[0].id], "processing removal cancels the server ID without needing a digest");
    pending[0].resolve(response({ source: { id: pending[0].id, filename: "trip-0.md", digest: "a".repeat(64), text: "LATE_REMOVED_CANARY" } }));
    await settle(5); renderer.flush(); assert.deepEqual(refs, []);
    assert.ok(!renderer.tree.map(textOf).join(" ").includes("LATE_REMOVED_CANARY"));
    renderer.render(createElement(CoordinatorSourceAttachments, { ...props, key: "ask", destination: "ask", onChange })); await settle(5); renderer.flush();
    for (const job of pending.slice(1)) job.resolve(response({ source: { id: job.id, filename: "old.md", digest: "b".repeat(64), text: "WRONG_DESTINATION_CANARY" } }));
    await settle(5); renderer.flush(); assert.deepEqual(refs, []);
    assert.ok(!renderer.tree.map(textOf).join(" ").includes("WRONG_DESTINATION_CANARY"));
  } finally { renderer.unmount(); globalThis.fetch = original; live.restore(); }
});

test("failed parsing, expired restore and legacy recovery are truthful and never auto-send", async () => {
  const live = installFakeLiveEnvironment(), original = globalThis.fetch;
  const legacyKey = "commons:synthetic:organizer:itinerary-intake:new";
  window.sessionStorage.setItem(legacyKey, "UNSENT_LEGACY_CANARY");
  let succeed = false, calls = 0, blocked = false;
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (!succeed) return response({ error: "Unreadable workbook" }, 400);
    return response({ source: { id: (init!.body as FormData).get("id"), filename: "Recovered notes.txt", digest: "c".repeat(64), text: "UNSENT_LEGACY_CANARY" } });
  };
  const renderer = createHookRenderer({ expand: [CoordinatorSourceAttachments] });
  try {
    const onChange = (_refs: unknown, busy: boolean) => { blocked = busy; };
    renderer.render(createElement(CoordinatorSourceAttachments, { ...props, onChange })); await settle(5); renderer.flush();
    assert.equal(calls, 0); assert.match(renderer.tree.map(textOf).join(" "), /UNSENT_LEGACY_CANARY/);
    click(renderer, "Attach recovered notes"); await settle(5); renderer.flush();
    assert.equal(blocked, true); assert.equal(window.sessionStorage.getItem(legacyKey), "UNSENT_LEGACY_CANARY");
    click(renderer, "Remove Recovered notes.txt"); succeed = true;
    click(renderer, "Attach recovered notes"); await settle(5); renderer.flush();
    assert.equal(window.sessionStorage.getItem(legacyKey), "UNSENT_LEGACY_CANARY");
    assert.equal(window.sessionStorage.getItem(legacyKey + ":dismissed"), "1"); assert.equal(blocked, false);
    renderer.unmount(); succeed = false;
    renderer.render(createElement(CoordinatorSourceAttachments, { ...props, onChange })); await settle(5); renderer.flush(); await settle(5); renderer.flush();
    assert.equal(blocked, true); assert.match(renderer.tree.map(textOf).join(" "), /Reattach the file/);
  } finally { renderer.unmount(); globalThis.fetch = original; live.restore(); }
});
