import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { buildMoneySummary, moneySummaryShareUrl, moneySummaryCsv } from "../lib/money-summary";
import { pilotSnapshot } from "../lib/pilot-fixture";
import { createHookRenderer, textOf } from "../lib/test-support/hook-harness";
import { MoneySummaryView } from "./money-summary";

test("sharing copies only the stable member link and exposes a selectable fallback on clipboard failure", async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let fail = false;
  const copied: string[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://www.commons.travel", search: "?person=someone-else" } } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { async writeText(value: string) { if (fail) throw new Error("denied"); copied.push(value); } } } });
  const renderer = createHookRenderer({ expand: [MoneySummaryView] });
  try {
    const summary = buildMoneySummary(pilotSnapshot);
    renderer.render(createElement(MoneySummaryView, { summary }));
    const share = () => (renderer.find(node => node.type === "button" && textOf(node) === "Share ledger").props.onClick as () => void)();
    share(); await Promise.resolve(); renderer.flush();
    assert.deepEqual(copied, [moneySummaryShareUrl("https://www.commons.travel", summary.tripId)]);
    assert.match(renderer.tree.map(textOf).join(" "), /Ledger link copied/);
    assert.equal(renderer.findAll(node => node.type === "input").length, 0);
    fail = true; share(); await Promise.resolve(); renderer.flush();
    assert.match(renderer.tree.map(textOf).join(" "), /Copy couldn’t complete/);
    const fallback = renderer.find(node => node.type === "input");
    assert.equal(fallback.props.value, copied[0]);
    assert.equal(fallback.props.readOnly, true);
    assert.equal(copied.length, 1, "Failure never reports another successful copy");
    assert.ok(renderer.find(node => node.props["aria-label"] === "Your balance"));
    renderer.render(createElement(MoneySummaryView, { summary: buildMoneySummary({ ...pilotSnapshot, commons: { ...pilotSnapshot.commons, balancesDisabled: true } }) }));
    assert.equal(renderer.findAll(node => node.props["aria-label"] === "Your balance").length, 0);
    assert.doesNotMatch(renderer.tree.map(textOf).join(" "), /their own balance/);
  } finally {
    renderer.unmount();
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator); else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("document export downloads the same private-safe CSV and retains the print action", async () => {
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,"window"), oldDocument=Object.getOwnPropertyDescriptor(globalThis,"document");
  const create=URL.createObjectURL, revoke=URL.revokeObjectURL;
  let content:Blob|null=null, clicked=false, removed=false, printed=false;
  const anchor={href:"",download:"",click(){clicked=true;},remove(){removed=true;}};
  Object.defineProperty(globalThis,"window",{configurable:true,value:{print(){printed=true;}}});
  Object.defineProperty(globalThis,"document",{configurable:true,value:{createElement(){return anchor;},body:{appendChild(){}}}});
  URL.createObjectURL=(blob)=>{content=blob as Blob;return "blob:qa-ledger";};URL.revokeObjectURL=()=>{};
  const renderer=createHookRenderer({expand:[MoneySummaryView]});
  try {
    const summary=buildMoneySummary(pilotSnapshot);renderer.render(createElement(MoneySummaryView,{summary}));
    (renderer.find(node=>node.type==="button"&&textOf(node)==="Download CSV").props.onClick as ()=>void)();
    assert.equal(clicked,true);assert.equal(removed,true);assert.equal(anchor.href,"blob:qa-ledger");assert.match(anchor.download,/^commons-ledger-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.deepEqual(new Uint8Array(await (content as unknown as Blob).arrayBuffer()),new TextEncoder().encode(moneySummaryCsv(summary)));
    (renderer.find(node=>node.type==="button"&&textOf(node)==="Print / Save PDF").props.onClick as ()=>void)();assert.equal(printed,true);
    URL.createObjectURL=()=>{throw Error("blocked");};
    (renderer.find(node=>node.type==="button"&&textOf(node)==="Download CSV").props.onClick as ()=>void)();renderer.flush();
    assert.match(renderer.tree.map(textOf).join(" "),/The download couldn’t start/);
  } finally {
    renderer.unmount();URL.createObjectURL=create;URL.revokeObjectURL=revoke;
    if(oldWindow)Object.defineProperty(globalThis,"window",oldWindow);else Reflect.deleteProperty(globalThis,"window");
    if(oldDocument)Object.defineProperty(globalThis,"document",oldDocument);else Reflect.deleteProperty(globalThis,"document");
  }
});
