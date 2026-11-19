import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { syntheticDraft } from '../../../packages/contracts/src/fixtures/research-itinerary';
import { createHookRenderer, registerComponentImportStubs, textOf } from '../lib/test-support/hook-harness';
import { installFakeLiveEnvironment, settle } from '../lib/test-support/fake-live-transport';
registerComponentImportStubs();

test('Plan review excludes unresolved/alternative/saved/flight/transport/downtime rows and requires a second exact-version approval', async () => {
  const live=installFakeLiveEnvironment(),{ItineraryPlanReview}=await import('./itinerary-plan-review');
  const draft=syntheticDraft(), item={...draft.content.items[0],id:'lunch',title:'Unhurried lunch',kind:'meal' as const,day:'2026-11-06',time:'13:00',endTime:'14:00',travelAnchor:null,alternative:false,decision:null,evidence:'suggestion' as const,participation:'group' as const};
  draft.content.items=[item,{...item,id:'flight',title:'Flight',kind:'transport',travelAnchor:'departure'},{...item,id:'van',title:'Van',kind:'transport'},{...item,id:'rest',title:'Rest',kind:'downtime'},{...item,id:'choice',title:'Which winery',decision:{question:'Where?',options:['A','B']}},{...item,id:'alternative',title:'Alternative',alternative:true},{...item,id:'already',title:'Already saved',evidence:'saved_fact'}];
  const calls:unknown[]=[],renderer=createHookRenderer({expand:[ItineraryPlanReview]});
  const props={draft,currentVersion:draft.version,disabled:false,onBack(){},onApply:async(ids:string[],version:number)=>{calls.push({ids,version});}};
  const click=(name:string)=>(renderer.find(n=>n.type==='button'&&textOf(n)===name).props.onClick as ()=>void)();
  try {
    renderer.render(createElement(ItineraryPlanReview,props));
    const checkboxes=renderer.findAll(n=>n.type==='input'&&n.props.type==='checkbox');assert.equal(checkboxes.length,1);assert.equal(checkboxes[0].props.checked,false);assert.deepEqual(calls,[]);
    (checkboxes[0].props.onChange as (e:unknown)=>void)({target:{checked:true}});renderer.flush();
    click('Review 1 addition');renderer.flush();assert.deepEqual(calls,[]);
    assert.match(renderer.tree.map(textOf).join(' '),/1:00 PM–2:00 PM.*Planned, unconfirmed.*Everyone/);
    assert.doesNotMatch(renderer.tree.map(textOf).join(' '),/PRIVATE_/);
    click('Save selected activities');await settle(5);renderer.flush();assert.deepEqual(calls,[{ids:['lunch'],version:draft.version}]);
    renderer.render(createElement(ItineraryPlanReview,{...props,currentVersion:draft.version+1}));renderer.flush();
    assert.match(renderer.tree.map(textOf).join(' '),/itinerary changed/);
    assert.equal(renderer.find(n=>n.type==='button'&&textOf(n)==='Save selected activities').props.disabled,true);
  } finally {renderer.unmount();live.restore();}
});

test('a failed save retains review selection; concurrent retry clicks dispatch once', async()=>{
  const live=installFakeLiveEnvironment(),{ItineraryPlanReview}=await import('./itinerary-plan-review');
  const draft=syntheticDraft();draft.content.items=[{...draft.content.items[0],id:'dinner',title:'Dinner',decision:null,alternative:false,evidence:'suggestion',travelAnchor:null}];
  let calls=0,release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
  const renderer=createHookRenderer({expand:[ItineraryPlanReview]});
  const click=(name:string)=>(renderer.find(n=>n.type==='button'&&textOf(n)===name).props.onClick as ()=>void)();
  try{
    renderer.render(createElement(ItineraryPlanReview,{draft,currentVersion:draft.version,disabled:false,onBack(){},onApply:async()=>{calls++;if(calls===1)throw new Error('Save not confirmed');await gate;}}));
    (renderer.find(n=>n.type==='input').props.onChange as (e:unknown)=>void)({target:{checked:true}});renderer.flush();click('Review 1 addition');renderer.flush();click('Save selected activities');await settle(5);renderer.flush();
    assert.match(renderer.tree.map(textOf).join(' '),/Save not confirmed/);assert.match(renderer.tree.map(textOf).join(' '),/Dinner/);
    const save=renderer.find(n=>n.type==='button'&&textOf(n)==='Save selected activities');(save.props.onClick as ()=>void)();(save.props.onClick as ()=>void)();await settle(5);renderer.flush();assert.equal(calls,2);release();await settle(5);
  }finally{release();renderer.unmount();live.restore();}
});

test('a chosen shortlist option becomes eligible; saved records show exact field updates; tasks need a named owner', async () => {
  const live=installFakeLiveEnvironment(),{ItineraryPlanReview}=await import('./itinerary-plan-review');
  const { shortlistFromChoices, syncDecisionOptions } = await import('@commons/contracts');
  const draft=syntheticDraft(), run='9941d72a-f822-4238-a5ac-cd5f3f4351f2', savedId='11111111-1111-4111-8111-111111111111';
  draft.evidence=[{runId:run,sourceId:'f',title:'Visit Flowers',url:'https://www.flowerswinery.com/visit',excerpt:'Groups of up to 12 guests are welcome. Open daily. $85 per person.',retrievedAt:'2026-10-16T22:02:14.122Z'}];
  const base={...draft.content.items[0],travelAnchor:null,alternative:false,evidence:'suggestion' as const,participation:'group' as const,sources:[{runId:run,sourceId:'f'}],unresolved:[]};
  const shortlist=shortlistFromChoices({id:'winery',sources:base.sources,location:''},['Flowers Vineyards & Winery','DaVero Farms & Winery'],draft.evidence,{partySize:9,day:'2026-11-06',requirements:['group_policy','eligible_day','price_basis']}).map(o=>({...o,note:'PRIVATE_NOTE'}));
  draft.content.items=[{...base,id:'winery',kind:'activity',title:'Friday winery visit',day:'2026-11-06',time:'10:00',endTime:'11:30',decision:{question:'Which?',options:syncDecisionOptions(shortlist),shortlist,chosenOptionId:shortlist[0].id}},
    {...base,id:'lunch',kind:'meal',title:'Lunch',day:'2026-11-06',time:'14:00',endTime:'15:00',decision:null,sources:[]}];
  draft.receipts=[{candidateId:'lunch',kind:'plan',savedId,commandId:'22222222-2222-4222-8222-222222222222'}];
  const planItems=[{id:savedId,title:'Lunch',startsAt:'2026-11-06T20:30:00.000Z',scheduledDate:'2026-11-06',durationMinutes:60,participantScope:'everyone' as const,status:'planned' as const,provenanceLabel:'x',version:'2026-10-19T10:00:00.000Z',note:'Plan note stays'}];
  const updates:unknown[]=[],tasks:unknown[]=[],renderer=createHookRenderer({expand:[ItineraryPlanReview]});
  const click=(name:string)=>(renderer.find(n=>n.type==='button'&&textOf(n)===name).props.onClick as ()=>void)();
  const text=()=>renderer.tree.map(textOf).join(' ');
  try {
    renderer.render(createElement(ItineraryPlanReview,{draft,currentVersion:draft.version,disabled:false,onBack(){},onApply:async()=>{},planItems,people:[{id:'p1',name:'Robin'},{id:'p2',name:'Sam',invited:true}],
      onUpdate:async(u:unknown)=>{updates.push(u);},onTask:async(t:unknown)=>{tasks.push(t);}}));
    assert.match(text(),/Friday winery visit: Flowers Vineyards & Winery/);
    assert.match(text(),/Chosen by an organizer/);
    assert.doesNotMatch(text(),/PRIVATE_NOTE/);
    assert.match(text(),/Start: 12:30 PM → 2:00 PM.*Location: Not set → Sonoma \/ Napa/);
    const updateBox=renderer.findAll(n=>n.type==='input'&&n.props.type==='checkbox')[1];
    (updateBox.props.onChange as (e:unknown)=>void)({target:{checked:true}});renderer.flush();
    click('Review 1 update');renderer.flush();
    assert.match(text(),/Notes, costs, booking details, arranger and who is included stay/);
    click('Save selected updates');await settle(5);renderer.flush();
    assert.deepEqual(updates,[[{candidateId:'lunch',savedId,expectedRecordVersion:'2026-10-19T10:00:00.000Z',fields:['time','location']}]]);
  } finally {renderer.unmount();live.restore();}
  const second=createHookRenderer({expand:[ItineraryPlanReview]});
  try {
    second.render(createElement(ItineraryPlanReview,{draft,currentVersion:draft.version,disabled:false,onBack(){},onApply:async()=>{},planItems,people:[{id:'p1',name:'Robin'}],onUpdate:async()=>{},onTask:async(t:unknown)=>{tasks.push(t);}}));
    const selects=second.findAll(n=>n.type==='select');
    (selects[0].props.onChange as (e:unknown)=>void)({target:{value:'lunch'}});second.flush();
    const review=()=>second.find(n=>n.type==='button'&&textOf(n)==='Review task');
    assert.equal(review().props.disabled,true,'no default owner');
    (second.findAll(n=>n.type==='select')[1].props.onChange as (e:unknown)=>void)({target:{value:'p1'}});second.flush();
    assert.equal(review().props.disabled,false);
    (review().props.onClick as ()=>void)();second.flush();
    assert.match(second.tree.map(textOf).join(' '),/books or confirms nothing and sends no message/);
    (second.find(n=>n.type==='button'&&textOf(n)==='Save task').props.onClick as ()=>void)();await settle(5);second.flush();
    assert.deepEqual(tasks,[{title:'Arrange Lunch',itemId:'lunch',ownerPersonId:'p1'}]);
  } finally {second.unmount();}
});
