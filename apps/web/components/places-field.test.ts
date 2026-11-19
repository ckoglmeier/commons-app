import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { PlacesField } from "./places-field";
import { createHookRenderer, textOf } from "../lib/test-support/hook-harness";

test("Places keeps saved chips, adds on Enter, removes individually, and preserves comma-containing names", () => {
  let value = "Scotland\nSweden\n";
  const renderer = createHookRenderer({ expand: [PlacesField] });
  const render = () => renderer.render(createElement(PlacesField, { value, onChange: next => { value = next; } }));
  const input = () => renderer.find(node => node.type === "input");
  const change = (text: string) => { (input().props.onChange as (e: unknown) => void)({ target: { value: text } }); render(); };
  const enter = (isComposing = false) => { let prevented = false; (input().props.onKeyDown as (e: unknown) => void)({ key: "Enter", nativeEvent: { isComposing }, preventDefault: () => { prevented = true; } }); render(); return prevented; };
  render();
  assert.equal(renderer.findAll(node => node.type === "button").length, 2);
  change("San Diego, California");
  assert.equal(enter(true), false);
  assert.equal(enter(), true);
  assert.equal(value, "Scotland\nSweden\nSan Diego, California\n");
  (renderer.find(node => node.props["aria-label"] === "Remove Sweden").props.onClick as () => void)(); render();
  assert.equal(value, "Scotland\nSan Diego, California\n");
  change("Ontario");
  assert.deepEqual(String(value).split("\n").filter(Boolean), ["Scotland", "San Diego, California", "Ontario"], "saving includes unfinished entry");
  renderer.unmount();
});

test("multiline paste adds chips and over-limit paste keeps prior input", () => {
  let value = "Scotland\n";
  const renderer = createHookRenderer({ expand: [PlacesField] });
  const render = () => renderer.render(createElement(PlacesField, { value, onChange: next => { value = next; } }));
  const paste = (text: string) => { (renderer.find(node => node.type === "input").props.onPaste as (e: unknown) => void)({ clipboardData: { getData: () => text }, currentTarget: { selectionStart: 0, selectionEnd: 0 }, preventDefault() {} }); render(); };
  render(); paste("Sweden\r\nEdinburgh");
  assert.equal(value, "Scotland\nSweden\nEdinburgh\n");
  const saved = value; paste(Array.from({length: 12}, (_, i) => `City ${i}`).join("\n"));
  assert.equal(value, saved);
  assert.match(textOf(renderer.find(node => node.props.role === "alert")), /12 places/);
  renderer.unmount();
});
