import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { planTemplateFor, welcomePollFor } from "@commons/domain";
import { prefillTripBudget } from "../lib/trip-budget/prefill";

const source = (name: string) => readFile(new URL(name, import.meta.url), "utf8");

test("Trip's big questions use the trip's template wording and its own poll ids", async () => {
  const code = await source("./trip-big-questions.tsx");
  assert.doesNotMatch(code, /Where are we going\?/, "wording comes from the template, not a local copy");
  assert.match(code, /planTemplateFor\(templateKey\)/);
  assert.match(code, /welcomePollFor\(template, question\.id\)/);
  assert.match(code, /Also to settle/);
  assert.match(code, /polls\/new\?question=\$\{encodeURIComponent\(text\)\}/);
  assert.equal(planTemplateFor(null).welcomeQuestions[0].title, "Where are we going?");
  assert.equal(planTemplateFor("family-reunion").welcomeQuestions[0].title, "Where will we gather?");
  assert.equal(welcomePollFor(planTemplateFor(null), "where")?.id, "decide-where");
  assert.equal(welcomePollFor(planTemplateFor("family-reunion"), "where")?.id, "reunion-where");
  assert.equal(planTemplateFor(null).openQuestions.length, 0);
  assert.ok(planTemplateFor("family-reunion").openQuestions.length > 0);
});

test("Plan's section labels and empty outline come from the trip's template", async () => {
  const app = await source("./commons-app.tsx");
  assert.doesNotMatch(app, /sectionLink\("schedule", "Activities"\)|sectionLink\("travel", "Travel & stays"\)|<h2>Activities<\/h2>|<h2>Travel &amp; stays<\/h2>/);
  assert.match(app, /planSections\.activities\.label/);
  assert.match(app, /planSections\.travel\.label/);
  assert.match(app, /A rough outline to start from/);
  assert.equal(planTemplateFor(null).planSections.activities.label, "Activities");
  assert.equal(planTemplateFor(null).planSections.travel.label, "Travel & stays");
  assert.deepEqual(planTemplateFor(null).planSections.outline, []);
  assert.equal(planTemplateFor("family-reunion").planSections.activities.label, "Get-togethers");
});

test("the budget worksheet seeds optional extras only from a template that has them", () => {
  const blank = prefillTripBudget({});
  assert.deepEqual(blank.optional, [{ id: "extra-1", label: "", perPerson: "", participants: "" }]);
  assert.deepEqual(prefillTripBudget({ optionalLabels: [] }).optional, blank.optional);
  const labels = planTemplateFor("family-reunion").money.costRules.filter(rule => rule.basis === "optional").map(rule => rule.label);
  assert.deepEqual(prefillTripBudget({ optionalLabels: labels }).optional, [{ id: "extra-1", label: "Outings", perPerson: "", participants: "" }]);
  assert.equal(planTemplateFor(null).money.costRules.length, 0);
});

test("New trip offers a plan kind choice, Trip first, and sends the key", async () => {
  const flow = await source("../app/new/event-creation-flow.tsx");
  assert.match(flow, /What kind of plan\?/);
  assert.match(flow, /PLAN_TEMPLATES\.length > 1/);
  assert.match(flow, /templateKey, entryContext/);
  const page = await source("../app/new/page.tsx");
  assert.match(page, /knownPlanTemplateKey\(query\.template\) \?\? DEFAULT_PLAN_TEMPLATE_KEY/);
});
