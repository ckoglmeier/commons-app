import { z } from "zod";
import { PollQuestionSchema, MAX_POLL_QUESTIONS, type PollQuestion, type PollOption } from "@commons/contracts";

/*
 * Poll framing help. The model returns a complete, reviewable draft of the title, the participant-visible introduction and the
 * questions. Identifiers it returns are only references to questions and options that already exist in the draft; they are
 * checked against the draft and never trusted. URLs, record links and quotes cannot be produced here.
 */
const SuggestedOption = z.object({
  id: z.string().max(40).nullable(), label: z.string().min(1).max(160), description: z.string().max(180).nullable(), exclusive: z.boolean(),
}).strict();
const SuggestedQuestion = z.object({
  id: z.string().max(40).nullable(), prompt: z.string().min(1).max(240), kind: z.enum(["choice", "text"]), required: z.boolean(),
  selectionMode: z.enum(["single", "multiple"]), options: z.array(SuggestedOption).max(6),
}).strict();
export const PollSuggestionSchema = z.object({
  explanation: z.string().min(1).max(600),
  clarification: z.string().max(300).nullable(),
  title: z.string().min(1).max(120).nullable(),
  introduction: z.string().min(1).max(500).nullable(),
  questions: z.array(SuggestedQuestion).max(8),
}).strict().superRefine((value, context) => {
  if (value.clarification && (value.questions.length || value.title || value.introduction)) context.addIssue({ code: "custom", message: "A clarification must come before a draft." });
  if (!value.clarification && !value.questions.length) context.addIssue({ code: "custom", message: "No suggestions returned." });
  for (const question of value.questions) {
    if (question.kind === "choice" && question.options.length < 2) context.addIssue({ code: "custom", message: "Choice questions need alternatives." });
    if (question.kind === "text" && question.options.length) context.addIssue({ code: "custom", message: "Written questions cannot have options." });
    if (new Set(question.options.map(option => option.label.toLowerCase())).size !== question.options.length) context.addIssue({ code: "custom", message: "Duplicate alternatives." });
  }
});
export type PollSuggestion = z.infer<typeof PollSuggestionSchema>;

/** What the server tells the client about the draft it sent: which questions the model could revise, and which options were supplied from saved trip records. */
export const PollSuggestionScopeSchema = z.object({
  editableQuestionIds: z.array(z.string().uuid()).max(MAX_POLL_QUESTIONS),
  suppliedOptionIds: z.array(z.string().uuid()).max(100),
}).strict();
export type PollSuggestionScope = z.infer<typeof PollSuggestionScopeSchema>;
export const PollFramingResponseSchema = z.object({ suggestion: PollSuggestionSchema, scope: PollSuggestionScopeSchema }).passthrough();

type DraftQuestion = { id: string; kind: string; options?: Array<{ id: string }> };

/** An `id` that does not name an existing question (or an option of that same question) becomes null, so it is treated as new. */
export function discardUnknownSuggestionIds(suggestion: PollSuggestion, draft: DraftQuestion[]): PollSuggestion {
  const byId = new Map(draft.map(question => [question.id, question]));
  const usedQuestions = new Set<string>();
  return { ...suggestion, questions: suggestion.questions.map(question => {
    const existing = question.id && !usedQuestions.has(question.id) ? byId.get(question.id) : undefined;
    const matched = existing && existing.kind === question.kind ? existing : undefined;
    if (matched) usedQuestions.add(matched.id);
    const optionIds = new Set((matched?.options ?? []).map(option => option.id));
    const usedOptions = new Set<string>();
    return { ...question, id: matched?.id ?? null, options: question.options.map(option => {
      const keep = matched && option.id && optionIds.has(option.id) && !usedOptions.has(option.id) ? option.id : null;
      if (keep) usedOptions.add(keep);
      return { ...option, id: keep };
    }) };
  }) };
}

/** Typed or linked content that a text-only suggestion cannot faithfully carry. Such questions are never offered for revision. */
export function isFramingEditableQuestion(question: PollQuestion) {
  if (question.kind === "text") return !question.organizerOnly && !question.foodField;
  if (question.kind !== "choice") return false;
  if (question.availability || question.itinerary || question.convergence || question.organizerOnly) return false;
  return question.options.every(option => !(option.housing || option.schedule || option.alternative || option.place || option.attendance || option.partySize || option.sleeping || option.property));
}

export type MaterializeContext = { questions?: PollQuestion[]; scope?: PollSuggestionScope };

/**
 * Turns a reviewed suggestion into draft questions. Unchanged identities keep their id and the original option's url and resource;
 * unknown ids are new. Options supplied from saved trip records keep their label. Questions the model could not see or revise are
 * retained after the suggested ones.
 */
export function materializePollSuggestions(suggestion: PollSuggestion, context: MaterializeContext = {}): PollQuestion[] {
  const parsed = PollSuggestionSchema.parse(suggestion);
  const current = context.questions ?? [];
  const editable = new Set(context.scope ? context.scope.editableQuestionIds : current.filter(isFramingEditableQuestion).map(question => question.id));
  const supplied = new Set(context.scope?.suppliedOptionIds ?? []);
  const sanitized = discardUnknownSuggestionIds(parsed, current.filter(question => editable.has(question.id) && isFramingEditableQuestion(question)));
  const byId = new Map(current.map(question => [question.id, question]));
  const retained = current.filter(question => !editable.has(question.id) || !isFramingEditableQuestion(question));
  const made = sanitized.questions.slice(0, Math.max(0, MAX_POLL_QUESTIONS - retained.length)).map(question => {
    const original = question.id ? byId.get(question.id) : undefined;
    if (question.kind === "text") return PollQuestionSchema.parse({ ...(original?.kind === "text" ? original : {}), id: original?.id ?? crypto.randomUUID(), kind: "text", prompt: question.prompt, required: question.required });
    const originalOptions = new Map(original?.kind === "choice" ? original.options.map(option => [option.id, option]) : []);
    const options = question.options.map(option => {
      const previous: PollOption | undefined = option.id ? originalOptions.get(option.id) : undefined;
      if (!previous) return { id: crypto.randomUUID(), label: option.label, description: option.description, exclusive: option.exclusive, url: null, resource: null };
      const keepLabel = Boolean(previous.resource) || supplied.has(previous.id);
      return { ...previous, label: keepLabel ? previous.label : option.label, description: option.description, exclusive: option.exclusive };
    });
    return PollQuestionSchema.parse({ ...(original?.kind === "choice" ? original : {}), id: original?.id ?? crypto.randomUUID(), kind: "choice", prompt: question.prompt,
      required: question.required, selectionMode: question.selectionMode, options });
  });
  return [...made, ...retained];
}
