import assert from "node:assert/strict";
import test from "node:test";
import { parseMultiOptionReply, parseOptionReply } from "./messaging";

const options = [{ key: "1", label: "Saturday" }, { key: "2", label: "Sunday" }, { key: "3", label: "Saturday night" }, { key: "4", label: "None of these", exclusive: true }];
const one = (body: string) => parseOptionReply(body, options)?.key ?? null;
const many = (body: string) => parseMultiOptionReply(body, options)?.keys ?? null;

test("the ways people answer with one option", () => {
  for (const [body, key] of [["2", "2"], ["2.", "2"], ["#2", "2"], ["option 2", "2"], ["number 2", "2"], ["2 please", "2"], ["the second one", "2"], ["second", "2"], ["two", "2"], ["i pick 2", "2"], ["Sunday", "2"], ["sunday please", "2"], ["let's do sunday", "2"], ["sunday works", "2"], ["SATURDAY NIGHT", "3"]] as const) assert.equal(one(body), key, body);
});

test("anything less than certain stays unclear, so it's asked again", () => {
  for (const body of ["banana", "9", "the seventh one", "sunday or saturday night", "not 2", "not sunday", "no to sunday", "2 but maybe 3", "i can't do sunday", "neither", "", "2 3"]) assert.equal(one(body), null, body);
  assert.equal(one("saturday night works"), "3", "said in full, so it isn't a coin toss");
});

test("a reply saying no, or only mentioning an option, is never a vote for it", () => {
  for (const body of ["Saturday doesn't work", "couldn't do Saturday", "Saturday is bad for me", "what's the plan for Saturday?", "is saturday ok", "saturday is fine I guess but ask me later", "dinner on saturday sounds fun"]) assert.equal(one(body), null, body);
  for (const body of ["Saturday works, Sunday doesn't", "1 but not 2", "what about saturday and sunday"]) assert.equal(many(body), null, body);
});

test("several options at once", () => {
  assert.deepEqual(many("1 and 2"), ["1", "2"]);
  assert.deepEqual(many("1, 2"), ["1", "2"]);
  assert.deepEqual(many("1 2"), ["1", "2"]);
  assert.deepEqual(many("1,2,3"), ["1", "2", "3"]);
  assert.deepEqual(many("Saturday and Sunday"), ["1", "2"]);
  assert.deepEqual(many("saturday night, sunday"), ["3", "2"]);
  assert.deepEqual(many("all"), ["1", "2", "3"], "all never includes None of these");
  assert.deepEqual(many("2"), ["2"]);
  assert.deepEqual(many("1 and 1"), ["1"]);
});

test("several options: one unclear part makes the whole reply unclear, and None of these stands alone", () => {
  for (const body of ["1 and banana", "1 and 9", "not 1 and 2", "1 and 4", "none of these and sunday", "banana", ""]) assert.equal(many(body), null, body);
  assert.deepEqual(many("none of these"), ["4"]);
  assert.deepEqual(many("4"), ["4"]);
});
