import type { PollQuestion } from "@commons/contracts";
import { materializePollSuggestions, type PollSuggestion, type PollSuggestionScope } from "./poll-suggestions";

/** Everything the suggestion depended on. If this changes after the request, the suggestion is stale. */
export function framingRevision(content: { framingRequest: string; intro: string; settledFacts: string; title: string; questions: PollQuestion[] }) {
  return JSON.stringify([content.framingRequest, content.intro, content.settledFacts, content.title, content.questions]);
}

export type FramingApplyPlan =
  | { ok: false; reason: "stale" | "clarification" }
  | { ok: true; title: string; intro: string; questions: PollQuestion[] };

/** Applies replace the draft's content and keep identities. A stale or clarification-only suggestion can never be applied. */
export function planFramingApply(input: { suggestion: PollSuggestion; scope: PollSuggestionScope; mode: "write" | "revise"; requestRevision: string; currentRevision: string;
  title: string; defaultTitle: string; intro: string; questions: PollQuestion[] }): FramingApplyPlan {
  if (input.requestRevision !== input.currentRevision) return { ok: false, reason: "stale" };
  if (input.suggestion.clarification) return { ok: false, reason: "clarification" };
  const titleOpen = !input.title.trim() || input.title === input.defaultTitle;
  return { ok: true,
    title: input.suggestion.title && (input.mode === "revise" || titleOpen) ? input.suggestion.title : input.title,
    intro: input.suggestion.introduction ?? input.intro,
    questions: materializePollSuggestions(input.suggestion, { questions: input.questions, scope: input.scope }) };
}
