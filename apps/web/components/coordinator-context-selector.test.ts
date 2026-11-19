import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CoordinatorContextSelector, type ContextGroup } from "./coordinator-context-selector";

const groups: ContextGroup[] = [
  { id: "current", label: "Main conversation", choices: [{ value: "thread:main", title: "Coordinator", detail: "Main conversation" }] },
  { id: "earlier", label: "Earlier conversations", choices: [
    { value: "thread:lodging", title: "Choose lodging", detail: "Exploring", action: { label: "Archive", ariaLabel: "Archive Choose lodging", run() {} } },
    { value: "poll:dinner", title: "Dinner poll", detail: "Poll" },
  ] },
  { id: "archived", label: "Archived", choices: [] },
];
const render = (props: Partial<Parameters<typeof CoordinatorContextSelector>[0]> = {}) => renderToStaticMarkup(createElement(CoordinatorContextSelector, { groups, selected: "thread:lodging", currentTitle: "Choose lodging", onChoose() {}, ...props }));

test("the selector is a real button that opens a labelled dialog, not a sidebar", () => {
  const html = render();
  assert.match(html, /<button[^>]*class="[^"]*workspace-selector-trigger[^"]*"[^>]*aria-haspopup="dialog"[^>]*>/);
  assert.match(html, /aria-label="Conversations, current: Choose lodging"/);
  const labelled = /<dialog[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
  assert.ok(labelled, "dialog is labelled");
  assert.match(html, new RegExp(`<h2 id="${labelled!.replace(/[:]/g, "\\$&")}">Conversations</h2>`));
  assert.doesNotMatch(html, /<aside|<nav/);
});

test("lists existing conversations by group with their lifecycle labels; empty groups are omitted", () => {
  const html = render();
  for (const text of ["Main conversation", "Earlier conversations", "Coordinator", "Choose lodging", "Exploring", "Dinner poll", "Poll"]) assert.match(html, new RegExp(text));
  assert.doesNotMatch(html, />Archived</);
  assert.equal((html.match(/class="workspace-thread workspace-selector-choice"/g) ?? []).length, 3);
});

test("the selected conversation is announced and labelled; per-row lifecycle actions are real buttons with names", () => {
  const html = render();
  const selected = [...html.matchAll(/<button[^>]*workspace-selector-choice[^>]*>/g)].map(match => match[0]).filter(tag => /aria-current="true"/.test(tag));
  assert.equal(selected.length, 1);
  assert.match(html, /Exploring · Selected/);
  assert.match(html, /<button type="button" class="workspace-thread-action"[^>]*aria-label="Archive Choose lodging"[^>]*>Archive<\/button>/);
});

test("busy, blocked or conflicted workspaces disable choices exactly as the old thread list did", () => {
  const html = render({ disabled: true, onNew() {} });
  const buttons = [...html.matchAll(/<button[^>]*(workspace-selector-choice|workspace-thread-action|workspace-selector-new)[^>]*>/g)].map(match => match[0]);
  assert.ok(buttons.length >= 5);
  assert.ok(buttons.every(tag => /disabled=""/.test(tag)));
});

test("a new-conversation action appears only when the workspace offers one", () => {
  assert.doesNotMatch(render(), /workspace-selector-new/);
  assert.match(render({ onNew() {}, newLabel: "New conversation" }), /workspace-selector-new[^>]*>New conversation<\/button>/);
});
