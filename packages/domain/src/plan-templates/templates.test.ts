import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PLAN_TEMPLATE_KEY, PLAN_TEMPLATES, defaultPollFor, knownPlanTemplateKey, planTemplateFor, validatePlanTemplate, welcomePollFor } from "./index";

test("every bundled template follows the format", () => {
  const keys = new Set<string>();
  for (const template of PLAN_TEMPLATES) {
    assert.deepEqual(validatePlanTemplate(template), [], template.key);
    assert.equal(keys.has(template.key), false); keys.add(template.key);
    for (const id of ["where", "when", "who"] as const) assert.ok(welcomePollFor(template, id), `${template.key} asks ${id}`);
  }
});

test("trips are the default and older plans fall back to them", () => {
  assert.equal(DEFAULT_PLAN_TEMPLATE_KEY, "travel-general");
  assert.equal(planTemplateFor(null).key, "travel-general");
  assert.equal(planTemplateFor("retired-kind").key, "travel-general");
  assert.equal(planTemplateFor("family-reunion").label, "Family reunion");
  assert.equal(knownPlanTemplateKey("family-reunion"), "family-reunion");
  assert.equal(knownPlanTemplateKey("<script>"), null);
});

test("the trip template keeps the original travel defaults", () => {
  const travel = planTemplateFor("travel-general");
  assert.deepEqual(travel.welcomeQuestions.map(question => question.title), ["Where are we going?", "When?", "Who’s in?"]);
  assert.deepEqual(travel.defaultPolls.map(poll => poll.id), ["decide-where", "decide-when", "decide-who", "early-hotel"]);
  assert.equal(defaultPollFor("decide-who")?.questions[0]?.id, "73000000-0000-4000-8000-000000000003");
  assert.deepEqual([travel.planSections.activities.label, travel.planSections.travel.label], ["Activities", "Travel & stays"]);
  assert.deepEqual([travel.openQuestions, travel.todos, travel.money.costRules, travel.planSections.outline], [[], [], [], []]);
});

test("the validator reports problems instead of accepting a broken template", () => {
  const broken = structuredClone(planTemplateFor("family-reunion"));
  broken.key = "Family Reunion";
  broken.welcomeQuestions.reverse();
  broken.defaultPolls[1]!.questions[0]!.id = broken.defaultPolls[0]!.questions[0]!.id;
  broken.money.costRules.push({ label: "Gifts", basis: "split" as never });
  const paths = validatePlanTemplate(broken).map(problem => problem.path);
  assert.ok(paths.includes("key"));
  assert.ok(paths.includes("welcomeQuestions"));
  assert.ok(paths.some(path => path.startsWith("defaultPolls.1.questions.0.id")));
  assert.ok(paths.includes("money.costRules.4.basis"));
});

test("a new plan starts from a known template and falls back to the trip template", async () => {
  const { newPlanTemplate } = await import("./index");
  const { CreateEventCreationDraftRequestSchema } = await import("@commons/contracts");
  assert.deepEqual(newPlanTemplate("family-reunion"), { key: "family-reunion", version: 1 });
  assert.deepEqual(newPlanTemplate("not-a-template"), { key: "travel-general", version: 1 });
  assert.deepEqual(newPlanTemplate(undefined), { key: "travel-general", version: 1 });
  assert.deepEqual(newPlanTemplate(42), { key: "travel-general", version: 1 });
  const base = { sourceKind: "description", title: "Summer reunion", timezone: "America/Denver" };
  assert.equal(CreateEventCreationDraftRequestSchema.parse({ ...base, templateKey: "family-reunion" }).sourceKind, "description");
  assert.equal(CreateEventCreationDraftRequestSchema.safeParse(base).success, true);
});
