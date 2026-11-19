import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { PublicPollSchema, itineraryParticipantDraft, type PollAnswer } from "@commons/contracts";
import { syntheticItinerary } from "../../../packages/contracts/src/fixtures/research-itinerary";
import { createHookRenderer, registerComponentImportStubs, textOf } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "../lib/test-support/fake-live-transport";
registerComponentImportStubs();

test("new core itinerary collects stop choices, meal suggestions and interests without an overall ballot; retry survives reload", async () => {
  const content = syntheticItinerary();
  content.items[1].decision = { question: "Which stop?", options: ["Museum", "Garden", "Skip"] };
  content.items.push({ ...content.items[0], id: "walk", title: "Coastal walk", day: null, time: null, participation: "optional" });
  content.opening="Welcome to our weekend together."; content.questions=[{id:"pace",prompt:"Would you prefer a quieter pace?"}];
  const data = itineraryParticipantDraft(content, () => crypto.randomUUID());
  const poll = PublicPollSchema.parse({ id: crypto.randomUUID(), publicId: "abcdef012345", event: { slug: "coast", name: "Coastal weekend", coverImageUrl: null }, ...data, status: "open", createdByName: "Organizer", responseCount: 0, resultsVisible: true, aggregates: [], createdAt: "2026-10-04T00:00:00Z" });
  const requests: Array<{ respondentName: string; answers: PollAnswer[] }> = [];
  let fail = true;
  const live = installFakeLiveEnvironment({ liveFetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return fail ? Response.json({ error: "Temporary failure" }, { status: 503 }) : Response.json({ poll, receiptToken: body.receiptToken ?? body.newReceiptToken, responseUpdatedAt: "2026-10-04T01:00:00Z" });
  } });
  const { ItineraryTravelerWorkspace } = await import("./itinerary-traveler-workspace");
  const { ItineraryMessage } = await import("./itinerary-message");
  const { ItineraryDocument } = await import("./itinerary-document");
  let renderer = createHookRenderer({ expand: [ItineraryTravelerWorkspace, ItineraryDocument, ItineraryMessage] });
  const click = (label: string) => (renderer.find(node => node.type === "button" && textOf(node) === label).props.onClick as () => void)();
  try {
    renderer.render(createElement(ItineraryTravelerWorkspace, { initialPoll: poll })); await settle(5); renderer.flush();
    assert.equal(renderer.findAll(node => node.props["aria-label"] === "Your response to the itinerary").length, 0);
    assert.equal(renderer.find(node => node.props["aria-label"] === "Shared itinerary").props["data-mobile-hidden"], false);
    assert.equal(renderer.find(node => node.props["aria-label"] === "Your comments to the organizer").props["data-mobile-hidden"], true);
    assert.match(renderer.tree.map(textOf).join(" "), /Review the itinerary/);
    assert.equal(renderer.findAll(node => node.type === "input").length, 1, "identity remains reachable outside the mobile pane switch");
    (renderer.find(node => node.type === "input").props.onChange as (event: unknown) => void)({ target: { value: "Taylor" } }); renderer.flush();
    click("Garden"); await settle(5); renderer.flush();
    assert.match(renderer.tree.map(textOf).join(" "), /Temporary failure/);
    assert.equal(renderer.find(node => node.props["aria-label"] === "Shared itinerary").props["data-mobile-hidden"], false, "vote status is visible while viewing the itinerary");
    renderer.unmount(); renderer = createHookRenderer({ expand: [ItineraryTravelerWorkspace, ItineraryDocument, ItineraryMessage] });
    renderer.render(createElement(ItineraryTravelerWorkspace, { initialPoll: poll })); await settle(5); renderer.flush();
    assert.match(renderer.tree.map(textOf).join(" "), /last response may have saved/);
    fail = false; click("Retry saved response"); await settle(5); renderer.flush();
    assert.deepEqual(requests[1], requests[0]);
    assert.deepEqual(requests[1].answers[0].optionIds, []);
    assert.equal(requests[1].answers[0].itineraryFeedback?.votes?.length, 1);
    click("Interested"); await settle(5); renderer.flush();
    assert.equal(requests.at(-1)!.answers[0].itineraryFeedback?.interests[0].choice, "yes");
    assert.equal(renderer.findAll(node=>node.type==="button"&&textOf(node)==="Suggest a spot").length,0);
    const suggestion = renderer.findAll(node => node.type === "button" && String(node.props["aria-label"]).startsWith("Add comment about Dinner"))[0];
    (suggestion.props.onClick as () => void)(); renderer.flush();
    assert.equal(renderer.find(node => node.props["aria-label"] === "Your comments to the organizer").props["data-mobile-hidden"], false);
    assert.equal(renderer.findAll(node => node.type === "input").length, 1);
    (renderer.find(node => node.type === "textarea").props.onChange as (event: unknown) => void)({ target: { value: "For dinner, try the harbor cafe" } }); renderer.flush();
    (renderer.find(node => node.type === "form").props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); await settle(5); renderer.flush();
    assert.match(renderer.tree.map(textOf).join(" "),/harbor cafe/);
    assert.equal(renderer.findAll(node=>node.type==="span"&&node.props.className==="itinerary-comment-count").length,1);
    click("Would you prefer a quieter pace?"); renderer.flush();
    assert.equal(renderer.find(node=>node.type==="textarea").props.value,"Would you prefer a quieter pace?\n");
    (renderer.find(node=>node.type==="textarea").props.onChange as (event:unknown)=>void)({target:{value:"Would you prefer a quieter pace? Yes, quieter Thursday please."}});renderer.flush();
    (renderer.find(node=>node.type==="form").props.onSubmit as (event:unknown)=>void)({preventDefault(){}});await settle(5);renderer.flush();
    const answer = requests.at(-1)!.answers[0];
    assert.deepEqual(answer.optionIds, []);
    assert.equal(answer.itineraryFeedback?.votes?.length, 1);
    assert.equal(answer.itineraryFeedback?.interests.length, 1);
    assert.match(answer.itineraryFeedback!.comments[0].text, /harbor cafe/);
    assert.ok(answer.itineraryFeedback!.comments[0].itemId);
    assert.equal(answer.itineraryFeedback!.comments[1].itemId,null);
    assert.match(answer.itineraryFeedback!.comments[1].text,/quieter Thursday/);
    assert.match(renderer.tree.map(textOf).join(" "),/Welcome to our weekend together/);
    assert.equal(renderer.findAll(node=>node.type==="details" && String(node.props.className)==="itinerary-stop").length,0,"shared piece notes are visible without disclosures");
  } finally { renderer.unmount(); live.restore(); }
});

 test("signed-in itinerary has no name input and submits only answers for server attribution",async()=>{
 const data=itineraryParticipantDraft(syntheticItinerary(),()=>crypto.randomUUID());const poll=PublicPollSchema.parse({...data,id:crypto.randomUUID(),publicId:"abcdef012346",event:{slug:"qa",name:"QA"},status:"open",createdByName:"Organizer",responseCount:0,resultsVisible:true,aggregates:[],createdAt:"2026-10-05T00:00:00Z",identityBound:true,authenticatedName:"Taylor QA"});let body:Record<string,unknown>|null=null;
 const live=installFakeLiveEnvironment({liveFetch:async(_url,init)=>{body=JSON.parse(String(init?.body));return Response.json({poll,receiptToken:crypto.randomUUID()+crypto.randomUUID()});}});const {ItineraryTravelerWorkspace}=await import("./itinerary-traveler-workspace");const renderer=createHookRenderer({expand:[ItineraryTravelerWorkspace]});
 try{renderer.render(createElement(ItineraryTravelerWorkspace,{initialPoll:poll}));await settle(5);renderer.flush();assert.equal(renderer.findAll(n=>n.type==="input").length,0);assert.match(renderer.tree.map(textOf).join(" "),/Responding as Taylor QA/);(renderer.find(n=>n.type==="textarea").props.onChange as (event:unknown)=>void)({target:{value:"A quieter Saturday please"}});renderer.flush();(renderer.find(n=>n.type==="form").props.onSubmit as (event:unknown)=>void)({preventDefault(){}});await settle(5);assert.ok(body);assert.equal("respondentName" in body!,false);}finally{renderer.unmount();live.restore();}
 });

for (const mode of ["saved", "moved", "rejected"] as const) {
 test(`comment save restores keyboard focus without stealing it (${mode})`, async () => {
  const data = itineraryParticipantDraft(syntheticItinerary(), () => crypto.randomUUID());
  const poll = PublicPollSchema.parse({...data,id:crypto.randomUUID(),publicId:"abcdef012349",event:{slug:"qa",name:"QA"},status:"open",createdByName:"Organizer",responseCount:0,resultsVisible:true,aggregates:[],createdAt:"2026-10-05T00:00:00Z",identityBound:true,authenticatedName:"Taylor QA"});
  let finish!: (response: Response) => void;
  const live=installFakeLiveEnvironment({liveFetch:async()=>new Promise<Response>(resolve=>{finish=resolve;})});
  const body = {}, other = {}, doc = {body,activeElement:{} as unknown};
  Object.defineProperty(globalThis,"document",{configurable:true,writable:true,value:doc});
  const {ItineraryTravelerWorkspace}=await import("./itinerary-traveler-workspace");
  const renderer=createHookRenderer({expand:[ItineraryTravelerWorkspace]});
  let focused=0;
  try {
   renderer.render(createElement(ItineraryTravelerWorkspace,{initialPoll:poll}));renderer.flush();
   const area=renderer.find(n=>n.type==="textarea");
   (area.props.ref as {current:unknown}).current={isConnected:true,matches:()=>false,focus:()=>{focused++;}};
   (area.props.onChange as (e:unknown)=>void)({target:{value:"Keep the quiet afternoon"}});renderer.flush();
   (renderer.find(n=>n.type==="form").props.onSubmit as (e:unknown)=>void)({preventDefault(){}});renderer.flush();
   doc.activeElement=mode==="moved"?other:body;
   finish(mode==="rejected" ? Response.json({error:"Please review this comment"},{status:400}) : Response.json({poll,receiptToken:crypto.randomUUID()+crypto.randomUUID()}));
   await settle(5);renderer.flush();
   assert.equal(focused,mode==="moved"?0:1);
   assert.equal(renderer.find(n=>n.type==="textarea").props.disabled,false);
   if(mode==="rejected") assert.equal(renderer.find(n=>n.type==="textarea").props.value,"Keep the quiet afternoon");
   else assert.equal(renderer.find(n=>n.type==="textarea").props.value,"");
   renderer.flush();assert.equal(focused,mode==="moved"?0:1,"a later render must not refocus");
  } finally {renderer.unmount();live.restore();}
 });
}
