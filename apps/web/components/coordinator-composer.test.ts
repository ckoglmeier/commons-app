import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { CoordinatorThreadSchema } from "@commons/contracts";
import { createHookRenderer, textOf } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "../lib/test-support/fake-live-transport";
import { withCoordinatorScenario, databaseTestsEnabled, actAs, params } from "../lib/server/coordinator-route-harness";
import { syntheticItinerary } from "../../../packages/contracts/src/fixtures/research-itinerary";

test("one composer starters populate without sending; actual source upload and long request use one turn and clear exact ready refs", { skip: !databaseTestsEnabled }, () => withCoordinatorScenario(async s => {
  const [{ CoordinatorWorkspace }, { CoordinatorSourceAttachments }, { AppRouterContext }, { CommonsComposerForm }] = await Promise.all([import("./coordinator-workspace"), import("./coordinator-source-attachments"), import("next/dist/shared/lib/app-router-context.shared-runtime"), import("./coordinator-assistant-ui")]);
  actAs(s.trip.organizerId);
  const initialThread = CoordinatorThreadSchema.parse(await (await s.routes.turn.GET(new Request(`http://localhost/api/v1/commons/${s.trip.eventId}/coordinator`), params(s.trip.eventId))).json());
  const submitted: Array<{text:string; target:{threadId:string}}> = [];
  const live = installFakeLiveEnvironment({ liveFetch: (url, init) => { if (url.endsWith("/turns") && init?.method === "POST") submitted.push(JSON.parse(String(init.body))); return s.network.fetch(url, init); } });
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  const renderer = createHookRenderer({ expand: [CoordinatorWorkspace, CoordinatorSourceAttachments, CommonsComposerForm], context: context => context === AppRouterContext ? router : undefined });
  const text = () => renderer.tree.map(textOf).join("\n");
  const input = () => renderer.find(node => node.props["aria-label"] === "Message your coordinator");
  const click = (label: string) => { (renderer.find(node => node.type === "button" && textOf(node) === label).props.onClick as () => void)(); renderer.flush(); };
  async function until(condition: () => boolean) { for (let i=0; i<400; i++) { renderer.flush(); if(condition()) return; await settle(10); } assert.ok(condition(), JSON.stringify({submitted, providerCalls:s.network.providerCalls.length, records:s.network.records.map(record=>({path:record.path,status:record.status,body:record.body})),info:s.infoLogs})+text().slice(-1500)); }
  try {
    renderer.render(createElement(CoordinatorWorkspace, { eventName: "Synthetic composer QA", slug: s.trip.eventId, actorId: s.trip.organizerId, initialThread, initialRecommendations: [], conversationAvailable: true, assistantUiEnabled: true, startNew: true }));
    await settle(5); renderer.flush();
    click("Help shape our itinerary"); assert.equal(input().props.value,"Help shape our itinerary");
    assert.equal(s.network.providerCalls.length,0); assert.equal(s.network.records.filter(r=>r.method==="POST" && r.path==="/turns").length,0);
    (input().props.onChange as (e:unknown)=>void)({target:{value:""}}); renderer.flush();
    click("Review a plan I already have"); assert.equal(input().props.value,"Review a plan I already have"); assert.equal(s.network.providerCalls.length,0);
    const picker=renderer.find(node=>node.type==="input" && node.props.type==="file");
    (picker.props.onChange as (e:unknown)=>void)({target:{files:[new File(["COMPOSER_SOURCE_CANARY Thursday dinner"],"trip.md")],value:"trip.md"}});
    await until(()=>/trip.md.*Ready/.test(text()));
    const request=("Build an itinerary from the attached source. "+"Keep it relaxed. ".repeat(180)).trim();
    (input().props.onChange as (e:unknown)=>void)({target:{value:request}}); renderer.flush();
    const content=syntheticItinerary(); content.items=content.items.map(item=>({...item,day:null})); s.next.extra=content;
    (renderer.find(node=>node.type==="form" && node.props.className==="review-composer").props.onSubmit as (e:unknown)=>void)({preventDefault(){}});
    await until(()=>submitted.length===1 && s.network.providerCalls.length>0);
    let state = await s.thread(submitted[0].target.threadId);
    for (let i=0; i<100 && state.turns.at(-1)?.status!=="completed"; i++) { await settle(20); renderer.flush(); state = await s.thread(submitted[0].target.threadId); }
    assert.equal(state.turns.at(-1).status,"completed",JSON.stringify(state.turns.at(-1)));
    await until(()=>!window.sessionStorage.getItem(`commons:${s.trip.eventId}:${s.trip.organizerId}:sources:new`) || window.sessionStorage.getItem(`commons:${s.trip.eventId}:${s.trip.organizerId}:sources:new`)==="[]");
    assert.match(JSON.stringify(s.network.providerCalls),/COMPOSER_SOURCE_CANARY/);
    assert.equal(state.turns.at(-1).userText,request);
    assert.equal(s.network.records.filter(r=>r.method==="POST" && r.path==="/turns").length,1);
    // Storage clears synchronously; the mounted attachment list clears on its
    // next animation frame. Verify both sides of the completed-command cleanup.
    await until(()=>!text().includes("Remove trip.md"));
    const stored=window.sessionStorage.getItem(`commons:${s.trip.eventId}:${s.trip.organizerId}:sources:new`);
    assert.ok(stored===null || stored==="[]");
    assert.ok(!text().includes("Itinerary notes"));
  } finally { renderer.unmount(); await settle(30); live.restore(); }
}, { environment: { COMMONS_ASSISTANT_UI_ENABLED:"true", COMMONS_COORDINATOR_RESEARCH_ENABLED:"false", COMMONS_COORDINATOR_STEERING_ENABLED:"false" } }));
