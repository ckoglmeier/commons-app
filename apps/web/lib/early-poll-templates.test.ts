import test from "node:test";
import assert from "node:assert/strict";
import { PollQuestionSchema } from "@commons/contracts";
import { getEarlyPollTemplate } from "./early-poll-templates";

test("each big-question starter becomes a valid poll once its blank choices are filled", () => {
  for (const id of ["decide-where", "decide-when", "decide-who"]) {
    const template = getEarlyPollTemplate(id);
    assert.ok(template, id);
    for (const question of template.questions) {
      const filled = question.kind === "choice" ? { ...question, options: question.options.map((option, index) => ({ ...option, label: option.label || `Choice ${index + 1}` })) } : question;
      assert.ok(PollQuestionSchema.safeParse(filled).success, `${id} parses`);
    }
  }
});

test("trip polls keep their ids and questions, and a reunion trip gets its own", () => {
  const where = getEarlyPollTemplate("decide-where", null)!;
  assert.equal(where.title, "Where should we go?");
  assert.deepEqual(where.questions.map(question => question.id), ["73000000-0000-4000-8000-000000000001"]);
  assert.deepEqual(getEarlyPollTemplate("decide-who")!.questions.map(question => question.id), ["73000000-0000-4000-8000-000000000003"]);
  const hotel = getEarlyPollTemplate("early-hotel", "travel-general")!;
  assert.equal(hotel.title, "Let’s pick where we’re staying.");
  assert.equal(hotel.questions.length, 8);
  assert.equal(hotel.questions[0].id, "72000000-0000-4000-8000-000000000001");
  assert.equal(getEarlyPollTemplate("nonsense"), null);
  assert.equal(getEarlyPollTemplate(undefined), null);
  const reunion = getEarlyPollTemplate("reunion-where", "family-reunion")!;
  assert.equal(reunion.title, "Where should we gather?");
  assert.equal(getEarlyPollTemplate("decide-where", "family-reunion")!.title, "Where should we go?", "older links still resolve");
});
