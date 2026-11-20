import type { PollQuestion } from "@commons/contracts";

/*
 * Plan templates: how Commons is extended to new kinds of group plans. The engine coordinates group plans with real
 * dates, places and shared money; a template decides what a new plan starts with. Trips are the first template, and the
 * interface still calls every plan a trip. See docs/templates.md.
 */

/** The three questions every plan settles before it's on. Their ids are fixed; a template words them. */
export type WelcomeQuestionId = "where" | "when" | "who";
export type WelcomeQuestion = { id: WelcomeQuestionId; title: string; help: string };

/** A ready-made poll the organizer can start from. `forQuestion` makes it the "Ask your group" poll for a welcome question. */
export type DefaultPoll = { id: string; title: string; intro: string; forQuestion?: WelcomeQuestionId; questions: PollQuestion[] };

/** Plan has two sections with fixed roles; a template can rename them and suggest a starting outline. */
export type PlanSections = {
  activities: { label: string };
  travel: { label: string };
  /** Short day-by-day outline shown as a suggestion while the plan is empty. Never saved as plan items. */
  outline: string[];
};

/** A to-do added for the organizer when the plan is created. */
export type StarterTodo = { title: string };

/** How a kind of cost is usually split. shared: everyone splits it; per_person: each person pays their own; optional: only people who opt in. */
export type CostRule = { label: string; basis: "shared" | "per_person" | "optional" };

export type PlanTemplate = {
  /** Stored on each plan. Lowercase letters, numbers and dashes. */
  key: string;
  /** Bump when a change should only apply to new plans. */
  version: number;
  /** What the organizer picks when starting a plan. */
  label: string;
  description: string;
  welcomeQuestions: [WelcomeQuestion, WelcomeQuestion, WelcomeQuestion];
  defaultPolls: DefaultPoll[];
  /** Things the group usually needs to settle beyond where, when and who. Each can become a poll. */
  openQuestions: string[];
  planSections: PlanSections;
  todos: StarterTodo[];
  money: { costRules: CostRule[] };
};

export type TemplateProblem = { path: string; message: string };

const KEY = /^[a-z][a-z0-9-]{2,47}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(problems: TemplateProblem[], path: string, value: unknown, max: number, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > max) problems.push({ path, message: `must be ${allowEmpty ? "" : "non-empty "}text up to ${max} characters` });
}

/** Checks a template against the format. Returns every problem found; an empty list means the template is valid. */
export function validatePlanTemplate(template: PlanTemplate): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  if (!KEY.test(template.key)) problems.push({ path: "key", message: "must be 3-48 lowercase letters, numbers or dashes, starting with a letter" });
  if (!Number.isInteger(template.version) || template.version < 1) problems.push({ path: "version", message: "must be a whole number from 1" });
  text(problems, "label", template.label, 60);
  text(problems, "description", template.description, 200);
  const ids = template.welcomeQuestions.map(question => question.id);
  if (ids.length !== 3 || ids[0] !== "where" || ids[1] !== "when" || ids[2] !== "who") problems.push({ path: "welcomeQuestions", message: "must be where, when and who, in that order" });
  template.welcomeQuestions.forEach((question, index) => { text(problems, `welcomeQuestions.${index}.title`, question.title, 80); text(problems, `welcomeQuestions.${index}.help`, question.help, 160); });
  const pollIds = new Set<string>(), questionIds = new Set<string>(), forQuestions = new Set<string>();
  template.defaultPolls.forEach((poll, index) => {
    const at = `defaultPolls.${index}`;
    if (!KEY.test(poll.id) || pollIds.has(poll.id)) problems.push({ path: `${at}.id`, message: "must be a unique lowercase id" });
    pollIds.add(poll.id);
    if (poll.forQuestion) { if (forQuestions.has(poll.forQuestion)) problems.push({ path: `${at}.forQuestion`, message: "only one poll per welcome question" }); forQuestions.add(poll.forQuestion); }
    text(problems, `${at}.title`, poll.title, 120); text(problems, `${at}.intro`, poll.intro, 300, true);
    if (!poll.questions.length || poll.questions.length > 20) problems.push({ path: `${at}.questions`, message: "must have 1-20 questions" });
    poll.questions.forEach((question, qIndex) => {
      if (!UUID.test(question.id) || questionIds.has(question.id)) problems.push({ path: `${at}.questions.${qIndex}.id`, message: "must be a unique UUID" });
      questionIds.add(question.id);
      text(problems, `${at}.questions.${qIndex}.prompt`, question.prompt, 300);
    });
  });
  if (template.openQuestions.length > 8) problems.push({ path: "openQuestions", message: "at most 8" });
  template.openQuestions.forEach((question, index) => text(problems, `openQuestions.${index}`, question, 160));
  text(problems, "planSections.activities.label", template.planSections.activities.label, 30);
  text(problems, "planSections.travel.label", template.planSections.travel.label, 30);
  if (template.planSections.outline.length > 10) problems.push({ path: "planSections.outline", message: "at most 10 lines" });
  template.planSections.outline.forEach((line, index) => text(problems, `planSections.outline.${index}`, line, 160));
  if (template.todos.length > 12) problems.push({ path: "todos", message: "at most 12" });
  template.todos.forEach((todo, index) => text(problems, `todos.${index}.title`, todo.title, 160));
  template.money.costRules.forEach((rule, index) => {
    text(problems, `money.costRules.${index}.label`, rule.label, 60);
    if (!["shared", "per_person", "optional"].includes(rule.basis)) problems.push({ path: `money.costRules.${index}.basis`, message: "must be shared, per_person or optional" });
  });
  return problems;
}
