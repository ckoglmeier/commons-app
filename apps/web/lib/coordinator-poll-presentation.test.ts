import test from "node:test";
import assert from "node:assert/strict";
import {mayPresentPollResult} from "./coordinator-poll-presentation";
test("late saved poll receipt cannot steal another artifact or reopen explicitly dismissed Work",()=>{
 const origin={selection:"draft:itinerary",dismissal:0};
 assert.equal(mayPresentPollResult(origin,{...origin}),true);
 assert.equal(mayPresentPollResult(origin,{selection:"draft:other-poll",dismissal:0}),false);
 assert.equal(mayPresentPollResult(origin,{selection:origin.selection,dismissal:1}),false);
 assert.equal(mayPresentPollResult(undefined,{...origin}),false,"another tab's command has no presentation permission here");
});
