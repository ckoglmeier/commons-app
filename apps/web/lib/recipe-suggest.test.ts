import assert from "node:assert/strict";
import test from "node:test";
import { suggestRecipe } from "./recipe-suggest";

test("clear short requests point at one guided recipe", () => {
  assert.equal(suggestRecipe("Help me pick dates and a location for this trip.")?.id, "dates_location");
  assert.equal(suggestRecipe("can we figure out when to go")?.id, "dates_location");
  assert.equal(suggestRecipe("who's coming?")?.id, "attendance");
  assert.equal(suggestRecipe("I need a headcount")?.id, "attendance");
  assert.equal(suggestRecipe("where should we stay")?.id, "lodging");
  assert.equal(suggestRecipe("coordinate everyone's flights")?.id, "transport");
});
test("anything unclear, long or matching more than one recipe suggests nothing", () => {
  assert.equal(suggestRecipe("hi"), null);
  assert.equal(suggestRecipe("Tell me about the weather in Napa in April"), null);
  assert.equal(suggestRecipe("Pick dates and also who's coming and where to stay"), null);
  assert.equal(suggestRecipe(`Help me pick dates ${"and more ".repeat(40)}`), null);
});
test("a suggestion is only a link description", () => {
  const suggestion = suggestRecipe("who's coming?")!;
  assert.deepEqual(Object.keys(suggestion).sort(), ["id", "label", "path"]);
});
