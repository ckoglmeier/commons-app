import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {CoordinatorComposerMenu,appendComposerHelp,composerRecipeChoices} from "./coordinator-composer-menu";
import {createHookRenderer,textOf} from "../lib/test-support/hook-harness";
import {installFakeLiveEnvironment} from "../lib/test-support/fake-live-transport";

test("source categories are inline guidance, Files opens intake, and help never sends",()=>{
 const live=installFakeLiveEnvironment(),renderer=createHookRenderer({expand:[CoordinatorComposerMenu]});let files=0;const guidance:string[]=[],requests:string[]=[];
 try{
  renderer.render(createElement(CoordinatorComposerMenu,{disabled:false,filesDisabled:false,buttonRef:{current:null},onFiles:()=>{files++;},onPasteCategory:value=>guidance.push(value),onHelp:value=>requests.push(value)}));
  const open=()=>{(renderer.find(node=>node.props["aria-label"]==="Add sources or get help").props.onClick as ()=>void)();renderer.flush();};
  open();assert.equal(renderer.find(node=>node.props.role==="menu").props["aria-label"],"Add or get help");assert.equal(renderer.findAll(node=>node.props.role==="menuitem").length,10);
  (renderer.find(node=>node.props.role==="menuitem"&&textOf(node)==="Email Thread").props.onClick as ()=>void)();renderer.flush();assert.match(guidance[0],/Paste the email thread here/);assert.equal(files,0);assert.deepEqual(requests,[]);
  open();(renderer.find(node=>node.props.role==="menuitem"&&textOf(node)==="Files").props.onClick as ()=>void)();renderer.flush();assert.equal(files,1);assert.equal(renderer.findAll(node=>node.props.role==="menu").length,0);
  open();(renderer.find(node=>node.props.role==="menuitem"&&textOf(node)==="Walk me through my todos").props.onClick as ()=>void)();renderer.flush();assert.deepEqual(requests,["Walk me through my outstanding trip todos."]);assert.equal(guidance.length,1);
 }finally{renderer.unmount();live.restore();}
});
test("help appends to unsent multiline text and refuses exceeding the source limit without truncating",()=>{
 assert.equal(appendComposerHelp("My existing draft\nwith details","Help with lodging"),"My existing draft\nwith details\n\nHelp with lodging");
 assert.equal(appendComposerHelp("","Help with lodging"),"Help with lodging");
 assert.equal(appendComposerHelp("x".repeat(30000),"Help with lodging"),null);
});

test("with recipes available the help menu links guided polls to Ask, keeps itinerary and todos conversational, and never sends",()=>{
 const live=installFakeLiveEnvironment(),renderer=createHookRenderer({expand:[CoordinatorComposerMenu]});const requests:string[]=[],links:string[]=[];
 try{
  renderer.render(createElement(CoordinatorComposerMenu,{disabled:false,filesDisabled:false,buttonRef:{current:null},onFiles:()=>{},onPasteCategory:()=>{},onHelp:value=>requests.push(value),recipesBase:"/c/wine",onRecipe:href=>links.push(href)}));
  (renderer.find(node=>node.props["aria-label"]==="Add sources or get help").props.onClick as ()=>void)();renderer.flush();
  const labels=renderer.findAll(node=>node.props.role==="menuitem").map(node=>textOf(node));
  assert.deepEqual(labels.slice(5),[...composerRecipeChoices.map(choice=>choice.label),"Shape the itinerary","Walk me through my todos","Ask the group"]);
  (renderer.find(node=>node.props.role==="menuitem"&&textOf(node)==="Find a place to stay").props.onClick as ()=>void)();renderer.flush();
  assert.deepEqual(links,["/c/wine/ask?new=lodging"]);assert.deepEqual(requests,[]);
  (renderer.find(node=>node.props["aria-label"]==="Add sources or get help").props.onClick as ()=>void)();renderer.flush();
  (renderer.find(node=>node.props.role==="menuitem"&&textOf(node)==="Ask the group").props.onClick as ()=>void)();renderer.flush();
  assert.equal(links[1],"/c/wine/ask");
  (renderer.find(node=>node.props["aria-label"]==="Add sources or get help").props.onClick as ()=>void)();renderer.flush();
  (renderer.find(node=>node.props.role==="menuitem"&&textOf(node)==="Shape the itinerary").props.onClick as ()=>void)();renderer.flush();
  assert.deepEqual(requests,["Help me shape our itinerary using our saved trip details."]);
 }finally{renderer.unmount();live.restore();}
});

test("Tools exposes explicit commands without sending or invoking a recipe",()=>{
 const live=installFakeLiveEnvironment(),renderer=createHookRenderer({expand:[CoordinatorComposerMenu]});const tools:string[]=[];
 try {
 renderer.render(createElement(CoordinatorComposerMenu,{disabled:false,filesDisabled:false,buttonRef:{current:null},searchAvailable:true,onFiles:()=>{},onPasteCategory:()=>{},onHelp:()=>{},onTool:command=>tools.push(command)}));
 (renderer.find(node=>node.props["aria-label"]==="Add sources or get help").props.onClick as ()=>void)();renderer.flush();
 assert.ok(renderer.find(node=>node.props.role==="group"&&node.props["aria-label"]==="Tools"));
 assert.deepEqual(renderer.findAll(node=>node.props.role==="menuitem").map(node=>textOf(node)).filter(label=>label.startsWith("/")),["/add (flight, hotel, activity, meal, transport)","/poll (create poll)","/task (create task)","/search (research a topic)"]);
 (renderer.find(node=>node.props.role==="menuitem"&&textOf(node)==="/search (research a topic)").props.onClick as ()=>void)();renderer.flush();
 assert.deepEqual(tools,["/search"]);assert.equal(renderer.findAll(node=>node.props.role==="menu").length,0);
 }finally{renderer.unmount();live.restore();}
});


test("non-owner Tools hides search and retains poll/task",()=>{
 const live=installFakeLiveEnvironment(),renderer=createHookRenderer({expand:[CoordinatorComposerMenu]});
 try{renderer.render(createElement(CoordinatorComposerMenu,{disabled:false,filesDisabled:false,buttonRef:{current:null},onFiles:()=>{},onPasteCategory:()=>{},onHelp:()=>{},onTool:()=>{}}));
 (renderer.find(node=>node.props["aria-label"]==="Add sources or get help").props.onClick as ()=>void)();renderer.flush();
 assert.deepEqual(renderer.findAll(node=>node.props.role==="menuitem").map(textOf).filter(label=>label.startsWith("/")),["/add (flight, hotel, activity, meal, transport)","/poll (create poll)","/task (create task)"]);
 }finally{renderer.unmount();live.restore();}
});
