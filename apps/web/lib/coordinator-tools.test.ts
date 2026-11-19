import test from "node:test";
import assert from "node:assert/strict";
import {coordinatorTool,putComposerTool,slashCommandChoices,addRecordCommand} from "./coordinator-tools";
test("tools run only as leading commands, preserve text, and do not treat quoted source as commands",()=>{
 assert.deepEqual(coordinatorTool("/poll Which meal?\nA or B"),{kind:"poll",request:"Which meal?\nA or B"});
 assert.equal(coordinatorTool('Email says: /book hotel'),null);
 assert.equal(coordinatorTool('“/search flights”'),null);
 assert.equal(coordinatorTool('/unknown foo'),null);
 assert.equal(putComposerTool("unsent\ntext","/poll"),"/poll unsent\ntext");
 assert.equal(putComposerTool("/poll unsent\ntext","/search"),"/search unsent\ntext");
 assert.equal(putComposerTool("x".repeat(30000),"/task"),null);
});


test("slash command discovery filters search and offers bounded canonical add types",()=>{
 assert.deepEqual(slashCommandChoices("/",false).map(c=>c.command),["/add","/poll","/task"]);
 assert.ok(slashCommandChoices("/",true).some(c=>c.command==="/search"));
 assert.deepEqual(slashCommandChoices("/ta",false).map(c=>c.command),["/task"]);
 assert.deepEqual(slashCommandChoices("/add ",false).map(c=>c.command),["/add flight","/add hotel","/add activity","/add meal","/add transport"]);
 assert.deepEqual(slashCommandChoices("/add h",false).map(c=>c.command),["/add hotel"]);
 assert.deepEqual(slashCommandChoices("/task Pack a charger",false),[]);
 assert.equal(addRecordCommand("/add FLIGHT"),"flight");assert.equal(addRecordCommand("Email says /add flight"),null);assert.equal(addRecordCommand("/add flight and book it"),null);
});
