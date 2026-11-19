import test from "node:test";
import assert from "node:assert/strict";
import { lodgingPlausible, lodgingRequest, optionFromChoice } from "./intent";

const names = ["Synthetic Bluff Villa", "Synthetic Harbor House", "Synthetic Dune Lodge"];

test("actual requests are claimed: imperatives and polite requests to research or choose", () => {
  for (const text of ["Find lodging options for the group", "Find us somewhere to stay", "Can you find us a place to stay?", "Could you please show us some cabins?", "Ok, search for hotels near the lifts"])
    assert.deepEqual(lodgingRequest(text), { kind: "research" }, text);
  assert.deepEqual(lodgingRequest("Go with option 2"), { kind: "choose", ordinal: 2, phrase: "option 2" });
  assert.deepEqual(lodgingRequest("Let's go with the second one"), { kind: "choose", ordinal: 2, phrase: "the second one" });
  assert.deepEqual(lodgingRequest("Yes, take #3."), { kind: "choose", ordinal: 3, phrase: "#3" });
  assert.deepEqual(lodgingRequest("Let's do the Harbor House"), { kind: "choose", ordinal: null, phrase: "the Harbor House" });
  assert.deepEqual(lodgingRequest("Take the cheaper one"), { kind: "choose", ordinal: null, phrase: "the cheaper one" });
});

test("questions, negations, hedges, reports, quotations, double choices and mixed requests are conversation, never a request", () => {
  for (const text of ["Don't choose option 2", "Do not go with option 2", "Why did you choose option 2?", "Should we go with option 2?", "Did Robin pick option 2?",
    "Robin said \"go with option 2\"", "Robin said to go with option 2", "Taylor suggested we go with option 2", "Maybe go with option 2 later", "I'm thinking about the second one",
    "Not option 2, go with option 3", "Go with option 1. Also, who is driving?", "Find lodging and tell me who hasn't confirmed", "Go with option 1. Then find lodging", "Which cabin is cheapest?"])
    assert.equal(lodgingRequest(text), "conversation", text);
});

test("messages that are not about lodging are left alone", () => {
  for (const text of ["What time is dinner?", "Find a restaurant for Saturday", "Pick a time for the ski lesson", "Thanks!"]) assert.equal(lodgingRequest(text), null, text);
});

test("only lodging-scoped messages are plausible for the resolver", () => {
  assert.equal(lodgingPlausible("What time should we leave on Friday?", names), false);
  assert.equal(lodgingPlausible("Thanks, that helps.", names), false);
  assert.equal(lodgingPlausible("Could you sort out some lodging for us?", []), true);
  assert.equal(lodgingPlausible("The Dune Lodge looks lovely", names), true);
  assert.equal(lodgingPlausible("the cheaper one is fine", names), true);
  assert.equal(lodgingPlausible("the cheaper one is fine", []), false, "a reference means nothing without a shortlist in the conversation");
});

test("a deterministic choice names one option by position or a unique name, otherwise nothing", () => {
  const options = names.map(name => ({ name }));
  assert.equal(optionFromChoice({ kind: "choose", ordinal: 2, phrase: "option 2" }, options)?.name, "Synthetic Harbor House");
  assert.equal(optionFromChoice({ kind: "choose", ordinal: 7, phrase: "option 7" }, options), undefined);
  assert.equal(optionFromChoice({ kind: "choose", ordinal: null, phrase: "the dune lodge" }, options)?.name, "Synthetic Dune Lodge");
  assert.equal(optionFromChoice({ kind: "choose", ordinal: null, phrase: "the cheaper one" }, options), undefined);
});

test("compound requests and alternative choices cannot silently select one lodging option", () => {
  for (const text of ["Go with option 1 or option 2", "Go with the first or second one", "Go with option 1 and option 2",
    "Go with option 1 and find a restaurant", "Go with option 1\nFind a restaurant", "Find lodging. Book a taxi.",
    "Go with the Harbor House or the Dune Lodge", "Find lodging and book a taxi"])
    assert.equal(lodgingRequest(text), "conversation", text);
});

test("generic comparisons and partial property words do not establish lodging scope", () => {
  for (const text of ["What is the cheapest way to get to the airport?", "Find a bigger car", "Dinner is expensive", "Is the harbor busy?", "Which flight has the most room?"])
    assert.equal(lodgingPlausible(text, names), false, text);
  for (const text of ["Take the cheaper one", "the cheapest option is fine", "the one with the most bedrooms", "Dune Lodge is fine"])
    assert.equal(lodgingPlausible(text, names), true, text);
});
