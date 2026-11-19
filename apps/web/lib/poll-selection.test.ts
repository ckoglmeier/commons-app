import assert from "node:assert/strict";
import test from "node:test";
import { updatePollChoiceSelection } from "./poll-selection";

test("single-choice poll questions replace the prior answer", () => {
  assert.deepEqual(updatePollChoiceSelection(["maybe"], "yes", "single", false, []), ["yes"]);
});

test("multi-choice date questions keep every workable date", () => {
  assert.deepEqual(updatePollChoiceSelection(["nov-5"], "nov-6", "multiple", false, ["neither"]), ["nov-5", "nov-6"]);
});

test("an exclusive answer clears dates and a date clears the exclusive answer", () => {
  assert.deepEqual(updatePollChoiceSelection(["nov-5", "nov-6"], "neither", "multiple", true, ["neither"]), ["neither"]);
  assert.deepEqual(updatePollChoiceSelection(["neither"], "nov-5", "multiple", false, ["neither"]), ["nov-5"]);
});
