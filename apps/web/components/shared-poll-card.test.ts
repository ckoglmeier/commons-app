import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {createHookRenderer,textOf} from "../lib/test-support/hook-harness";
import {SharedPollCard} from "./shared-poll-card";
test("shared card pins published identity and has truthful state/count without mutable draft data",()=>{
 const renderer=createHookRenderer({expand:[SharedPollCard]});try{renderer.render(createElement(SharedPollCard,{slug:"trip",poll:{id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",publicId:"abcdef012345",title:"Reviewed weekend",threadId:null,status:"closed",createdAt:"2026-10-05T00:00:00Z",audienceRestricted:true,responseCount:3,resultsVisible:true,results:[],superseded:true}}));const text=renderer.tree.map(textOf).join(" ");assert.match(text,/Shared.*Closed.*Earlier version.*3 responses/);assert.match(text,/doesn’t confirm any email was delivered/);assert.equal(renderer.find(n=>n.type==="a"&&textOf(n)==="Open poll").props.href,"/c/poll/abcdef012345");assert.equal(renderer.find(n=>n.type==="a"&&textOf(n)==="View results").props.href,"/c/trip/polls/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");assert.equal(renderer.findAll(n=>n.type==="button"&&textOf(n)==="Copy link").length,1);}finally{renderer.unmount();}
});
