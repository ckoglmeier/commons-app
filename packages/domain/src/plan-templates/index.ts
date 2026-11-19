import { familyReunionTemplate } from "./family-reunion";
import type { PlanTemplate } from "./format";
import { travelTemplate } from "./travel";

export * from "./format";
export { familyReunionTemplate } from "./family-reunion";
export { travelTemplate } from "./travel";

/** Every bundled template, the trip template first. Add a template by writing a file like family-reunion.ts and listing it here. */
export const PLAN_TEMPLATES: readonly PlanTemplate[] = [travelTemplate, familyReunionTemplate];

export const DEFAULT_PLAN_TEMPLATE_KEY = travelTemplate.key;

/** The template for a stored key. Plans created before templates existed, or with a key this copy doesn't have, use the trip template. */
export function planTemplateFor(key: string | null | undefined): PlanTemplate {
  return PLAN_TEMPLATES.find(template => template.key === key) ?? travelTemplate;
}

/** A known template key, or null. */
export function knownPlanTemplateKey(key: unknown): string | null {
  return typeof key === "string" && PLAN_TEMPLATES.some(template => template.key === key) ? key : null;
}

/** A default poll by id, from the given template or, for older links, from any bundled template. */
export function defaultPollFor(id: string | null | undefined, template?: PlanTemplate) {
  if (!id) return null;
  return (template?.defaultPolls.find(poll => poll.id === id)) ?? PLAN_TEMPLATES.flatMap(item => item.defaultPolls).find(poll => poll.id === id) ?? null;
}

/** The "Ask your group" poll for a welcome question. */
export function welcomePollFor(template: PlanTemplate, question: "where" | "when" | "who") {
  return template.defaultPolls.find(poll => poll.forQuestion === question) ?? null;
}

/** The template a new plan starts from: the requested key if this copy has it, otherwise the trip template. */
export function newPlanTemplate(key: unknown): { key: string; version: number } {
  const template = planTemplateFor(knownPlanTemplateKey(key));
  return { key: template.key, version: template.version };
}
