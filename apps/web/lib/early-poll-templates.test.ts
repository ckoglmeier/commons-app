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
