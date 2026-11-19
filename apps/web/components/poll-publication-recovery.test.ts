import test from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { randomUUID } from "node:crypto";
import { PollWorkingDraftSchema } from "@commons/contracts";
import { createHookRenderer, registerComponentImportStubs, textOf } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "../lib/test-support/fake-live-transport";
registerComponentImportStubs(); Object.assign(globalThis, { React });
for (const firstFails of [false, true]) test(`publication recovery with stalled navigation; initial failure=${firstFails}`, async () => {
  const pollId = randomUUID(), personId = randomUUID();
  const bodies: Array<{commandId: string}> = [], paths: string[] = [];
  let refreshes = 0;
  const live = installFakeLiveEnvironment({ liveFetch: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return firstFails && bodies.length === 1 ? Response.json({error:"Try again"}, {status:503}) : Response.json({poll:{id:pollId}}, {status:201});
  }});
  Object.assign(window, {scrollTo() {}});
  const { PollStarter } = await import("../app/c/[slug]/polls/new/poll-starter");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const renderer = createHookRenderer({expand:[PollStarter], context:c => c === AppRouterContext ? {push(href:string) {paths.push(href);}, refresh() {refreshes++;}} : undefined});
  const draft = PollWorkingDraftSchema.parse({id:randomUUID(), version:1, publishedPollId:null, updatedAt:new Date().toISOString(), data:{title:"QA poll", intro:null, ballotMode:"transparent", audience:{personIds:[personId],guestEmails:[]}, questions:[{id:randomUUID(),kind:"text",prompt:"Which weekend?",required:false}]}});
  const click = async (label:string) => { (renderer.find(n => n.type === "button" && textOf(n) === label).props.onClick as () => void)(); await settle(3); renderer.flush(); };
  try {
    renderer.render(createElement(PollStarter,{slug:"qa-trip",eventName:"QA",initialDraft:draft,people:[{id:personId,name:"QA traveler"}]}));
    await click("Preview poll"); await click("Publish poll");
    if(firstFails) {assert.match(renderer.tree.map(textOf).join(" "),/Try again/); await click("Publish poll"); assert.equal(bodies[0].commandId,bodies[1].commandId);}
    assert.deepEqual(paths,[`/c/qa-trip/polls/${pollId}/`]); assert.equal(refreshes,0);
    assert.match(renderer.tree.map(textOf).join(" "),/Poll published/);
    assert.equal(renderer.find(n => n.type === "a" && textOf(n) === "Open poll").props.href,paths[0]);
    assert.equal(renderer.findAll(n => n.type === "button" && /Publish poll|Edit poll/.test(textOf(n))).length,0);
  } finally {renderer.unmount();live.restore();}
});
