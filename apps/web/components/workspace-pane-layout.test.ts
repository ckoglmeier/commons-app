import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspacePaneLayout } from "./workspace-pane-layout";

const render = (props: Partial<Parameters<typeof WorkspacePaneLayout>[0]> = {}) => renderToStaticMarkup(createElement(WorkspacePaneLayout, {
  work: createElement("aside", { id: "the-work" }, "WORK-CONTENT"),
  conversation: createElement("section", { id: "the-chat" }, createElement("textarea", { "aria-label": "Message your coordinator" })),
  workOpen: true, expanded: false, ratio: 0.56, onRatioChange() {}, ...props,
}));
const tag = (html: string, pattern: RegExp) => html.match(pattern)?.[0] ?? "";

test("DOM order is Work, separator, conversation and both subtrees are always mounted", () => {
  for (const props of [{ workOpen: false }, { workOpen: true }, { workOpen: true, expanded: true }]) {
    const html = render(props);
    const work = html.indexOf("WORK-CONTENT"), separator = html.indexOf('role="separator"'), chat = html.indexOf('id="the-chat"');
    assert.ok(work > -1 && separator > work && chat > separator, `order for ${JSON.stringify(props)}`);
    assert.equal((html.match(/aria-label="Message your coordinator"/g) ?? []).length, 1, "exactly one composer instance");
    assert.equal((html.match(/WORK-CONTENT/g) ?? []).length, 1, "exactly one Work subtree");
  }
});

test("closed Work keeps the conversation and hides plus inerts Work; no empty column is reserved", () => {
  const html = render({ workOpen: false });
  assert.match(html, /data-mode="conversation"/);
  assert.match(tag(html, /<div class="workspace-pane-slot workspace-pane-slot--work"[^>]*>/), /hidden=""[^>]*inert=""|inert=""[^>]*hidden=""/);
  assert.doesNotMatch(tag(html, /<div class="workspace-pane-slot workspace-pane-slot--conversation"[^>]*>/), /hidden|inert/);
  assert.match(tag(html, /<div class="workspace-pane-separator"[^>]*>/), /hidden=""/, "the separator is not focusable without a split");
});

test("full-content Work hides and inerts the conversation without unmounting it", () => {
  const html = render({ workOpen: true, expanded: true });
  assert.match(html, /data-mode="full"/);
  assert.match(tag(html, /<div class="workspace-pane-slot workspace-pane-slot--conversation"[^>]*>/), /hidden=""/);
  assert.match(tag(html, /<div class="workspace-pane-slot workspace-pane-slot--conversation"[^>]*>/), /inert=""/);
  assert.doesNotMatch(tag(html, /<div class="workspace-pane-slot workspace-pane-slot--work"[^>]*>/), /hidden|inert/);
  assert.match(html, /aria-label="Message your coordinator"/);
});

test("until the container is measured only one surface shows: Work replaces the conversation", () => {
  const html = render({ workOpen: true });
  assert.match(html, /data-mode="work"/);
  assert.match(html, /data-fits="false"/);
  assert.match(tag(html, /<div class="workspace-pane-slot workspace-pane-slot--conversation"[^>]*>/), /hidden=""/);
});

test("the separator is a labeled, focusable, vertical window splitter with value, bounds and the Work slot it controls", () => {
  const html = render({ separatorLabel: "Resize working material and conversation", workId: "work-slot" });
  const separator = tag(html, /<div class="workspace-pane-separator"[^>]*>/);
  assert.match(separator, /role="separator"/);
  assert.match(separator, /aria-orientation="vertical"/);
  assert.match(separator, /aria-label="Resize working material and conversation"/);
  assert.match(separator, /aria-controls="work-slot"/);
  assert.match(separator, /tabindex="0"/);
  const now = Number(/aria-valuenow="(\d+)"/.exec(separator)?.[1]), min = Number(/aria-valuemin="(\d+)"/.exec(separator)?.[1]), max = Number(/aria-valuemax="(\d+)"/.exec(separator)?.[1]);
  assert.ok(Number.isFinite(now) && Number.isFinite(min) && Number.isFinite(max) && min <= now && now <= max, `valuenow ${now} lies within ${min}..${max}`);
  assert.match(html, /id="work-slot"/);
});
