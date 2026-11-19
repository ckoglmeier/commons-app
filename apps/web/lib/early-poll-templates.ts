import { defaultPollFor, planTemplateFor } from "@commons/domain";

/** A ready-made poll for an id (`decide-*`, `early-hotel`, a template's own). The data lives in the plan templates. */
export function getEarlyPollTemplate(templateId?: string, templateKey?: string | null) {
  return defaultPollFor(templateId, planTemplateFor(templateKey));
}
