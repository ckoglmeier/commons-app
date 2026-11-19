import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { createHookRenderer, registerComponentImportStubs, textOf } from "./test-support/hook-harness";
import { createWorkflowEditorFixtureTransport, workflowEditorFixtures } from "./workflow-editor-fixture";

async function editor(fetcher = createWorkflowEditorFixtureTransport()) {
  registerComponentImportStubs();
  const { WorkflowEditor } = await import("../app/admin/workflows/workflow-editor");
  const renderer = createHookRenderer({ expand: [WorkflowEditor as never] });
  renderer.render(createElement(WorkflowEditor, { initialTemplates: workflowEditorFixtures, fetcher }));
  const input = (id: string) => renderer.find(node => node.props.id === id);
  const button = (label: string) => renderer.find(node => node.type === "button" && textOf(node) === label);
  const change = (id: string, value: string) => { (input(id).props.onChange as (event: unknown) => void)({ target: { value } }); renderer.flush(); };
  const click = (label: string) => { (button(label).props.onClick as () => void)(); renderer.flush(); };
  const idle = async () => { for (let i = 0; i < 30; i++) { await new Promise(resolve => setTimeout(resolve, 1)); renderer.flush(); if (!renderer.findAll(node => node.type === "button" && textOf(node) === "Working…").length) return; } throw new Error("Editor command did not settle"); };
  const save = async () => { (renderer.find(node => node.type === "form").props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); renderer.flush(); await idle(); };
  return { renderer, input, button, change, click, idle, save };
}
test("editor saves an immutable draft revision, keeps history and requires explicit activation", async () => {
  const e = await editor();
  e.change("workflow-instructions", "Make this synthetic poll concise. No saving, sending or booking authority.");
  assert.equal(e.button("New workflow").props.disabled, true, "unsaved edits cannot be lost by switching");
  await e.save();
  assert.equal(e.input("workflow-version").children.length, 2);
  assert.equal(e.button("Activate version 2").props.disabled, true);
  e.click("Activate version 2"); await e.idle();
  assert.equal(e.button("Activate version 2").props.disabled, true);
  const checkbox = e.renderer.find(node => node.type === "input" && node.props.type === "checkbox");
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } }); e.renderer.flush();
  e.click("Activate version 2"); await e.idle();
  assert.equal(e.renderer.findAll(node => node.type === "button" && textOf(node) === "Activate version 2").length, 0);
  assert.match(e.renderer.tree.map(textOf).join(" "), /active for new drafts.*Existing drafts are unchanged/);
  e.renderer.unmount();
});
test("lost save response retains text and safely reuses the command instead of creating another version", async () => {
  const transport = createWorkflowEditorFixtureTransport(), commands: string[] = []; let lose = true;
  const fetcher: typeof fetch = async (input, init) => {
    if (init?.method === "POST") commands.push(JSON.parse(String(init.body)).commandId);
    const result = await transport(input, init);
    if (init?.method === "POST" && lose) { lose = false; throw new Error("Synthetic lost response"); }
    return result;
  };
  const e = await editor(fetcher), text = "Preserve this synthetic edited text. Never book or send.";
  e.change("workflow-instructions", text); await e.save();
  assert.equal(e.input("workflow-instructions").props.value, text);
  assert.match(e.renderer.tree.map(textOf).join(" "), /retry safely/);
  await e.save(); assert.equal(commands.length, 2); assert.equal(commands[0], commands[1]);
  assert.equal(e.input("workflow-version").children.length, 2); e.renderer.unmount();
});
test("stale save refreshes versions without erasing edits; new workflow chooses a bounded supported handler", async () => {
  const transport = createWorkflowEditorFixtureTransport(); let conflict = true;
  const e = await editor(async (input, init) => {
    if (init?.method === "POST" && conflict) { conflict = false; return Response.json({ error: "Synthetic stale workflow" }, { status: 409 }); }
    return transport(input, init);
  });
  const text = "Preserve my synthetic text while a conflicting change is reviewed.";
  e.change("workflow-instructions", text); await e.save(); assert.equal(e.input("workflow-instructions").props.value, text);
  assert.match(e.renderer.tree.map(textOf).join(" "), /Synthetic stale workflow/);
  await e.save(); e.click("New workflow");
  e.change("workflow-key", "qa_itinerary"); e.change("workflow-purpose", "itinerary");
  e.change("workflow-title", "QA itinerary"); e.change("workflow-description", "Synthetic reusable itinerary recipe."); e.change("workflow-instructions", "Use saved constraints and supplied evidence. Do not book anything.");
  await e.save(); assert.equal(e.input("workflow-purpose").props.value, "itinerary");
  assert.equal(e.input("workflow-purpose").props.disabled, true); assert.equal(e.button("Activate version 1").props.disabled, true);
  e.renderer.unmount();
});
