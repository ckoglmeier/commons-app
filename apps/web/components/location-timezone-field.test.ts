import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { LocationTimezoneField } from "./location-timezone-field";
import { createHookRenderer, textOf } from "../lib/test-support/hook-harness";

const wait = () => new Promise(resolve => setTimeout(resolve, 280));
test("timezone lookup debounces, ignores stale replies, requires selection and preserves manual override", async () => {
  const original = globalThis.fetch;
  let releaseOld: (response: Response) => void = () => {};
  const requests: string[] = [];
  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    if (url.includes("edin")) return new Promise<Response>(resolve => { releaseOld = resolve; });
    return Response.json({ matches: [{ id: "kiruna", label: "Kiruna, Sweden", timezone: "Europe/Stockholm" }] });
  }) as typeof fetch;
  let timezone = "America/Chicago";
  const renderer = createHookRenderer({ expand: [LocationTimezoneField] });
  const render = () => renderer.render(createElement(LocationTimezoneField, { value: timezone, onChange: next => { timezone = next; }, initialQuery: "" }));
  const search = () => renderer.find(node => node.type === "input" && node.props.placeholder === "San Francisco or SFO");
  const change = (query: string) => { (search().props.onChange as (e: unknown) => void)({ target: { value: query } }); renderer.flush(); };
  try {
    render(); change("edin"); await wait(); change("kiruna"); await wait(); renderer.flush();
    assert.equal(timezone, "America/Chicago", "search does not select or mutate the timezone");
    assert.equal(requests.length, 2);
    releaseOld(Response.json({ matches: [{ id: "edinburgh", label: "Edinburgh", timezone: "Europe/London" }] }));
    await Promise.resolve(); await Promise.resolve(); renderer.flush();
    assert.equal(renderer.findAll(node => node.type === "button").length, 1);
    const button = renderer.find(node => node.type === "button"); assert.match(textOf(button), /Kiruna/);
    (button.props.onClick as () => void)(); renderer.flush(); render();
    assert.equal(timezone, "Europe/Stockholm");
    assert.equal(search().props.value, "");
    const manual = renderer.find(node => node.type === "input" && node.props.placeholder === "America/Los_Angeles");
    (manual.props.onChange as (e: unknown) => void)({ target: { value: "Europe/London" } }); renderer.flush(); render();
    assert.equal(timezone, "Europe/London");
    assert.equal(renderer.findAll(node => node.type === "p" && textOf(node).startsWith("Timezone from")).length, 0);
  } finally { renderer.unmount(); globalThis.fetch = original; }
});

test("lookup failure reports unavailable search instead of claiming no city exists", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ error: "Unavailable" }, { status: 503 })) as typeof fetch;
  const renderer = createHookRenderer({ expand: [LocationTimezoneField] });
  try {
    renderer.render(createElement(LocationTimezoneField, { value: "America/Chicago", onChange() {}, initialQuery: "Edinburgh" }));
    await wait(); renderer.flush();
    assert.match(textOf(renderer.find(node => node.props.role === "status")), /search is unavailable/);
    assert.equal(renderer.findAll(node => node.type === "input").length, 2, "manual entry remains available");
  } finally { renderer.unmount(); globalThis.fetch = original; }
});
