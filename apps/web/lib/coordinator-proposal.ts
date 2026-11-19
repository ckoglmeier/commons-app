import { randomUUID } from "node:crypto";
import { PollCommunicationSchema, PollWorkingDataSchema, type PollWorkingData } from "@commons/contracts";
import { z } from "zod";
import { applyReviewReply, ReviewReplySchema, reviewChanges, reviewCheckpoint, reviewPriceTokens } from "./coordinator-review";

const option = z.object({ label: z.string().trim().min(1).max(160), description: z.string().max(180).nullable() }).strict();
const messageLinkOperation = z.object({ kind: z.literal("add_message_link"), link: PollCommunicationSchema.shape.links.element }).strict();
const pollQuestionOperations = [
  z.object({ kind: z.literal("add_question"), prompt: z.string().trim().min(1).max(240), selectionMode: z.enum(["single", "multiple"]), options: z.array(option).min(2).max(12) }).strict(),
  z.object({ kind: z.literal("add_optional_question"), prompt: z.string().trim().min(1).max(240), selectionMode: z.enum(["single", "multiple"]), options: z.array(option).min(2).max(12) }).strict(),
  z.object({ kind: z.literal("add_text_question"), prompt: z.string().trim().min(1).max(240), required: z.boolean() }).strict(),
  z.object({ kind: z.literal("add_workflow_question"), prompt: z.string().trim().min(1).max(240), selectionMode: z.enum(["single", "multiple"]), options: z.array(option.extend({ exclusive: z.boolean(), url: PollCommunicationSchema.shape.links.element.shape.url.nullable() })).min(2).max(12) }).strict(),
] as const;
/** Shared option wording limits for construction and reviewed edits. */
export const CoordinatorOptionSchema = option;
export const CoordinatorOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add_option"), questionId: z.string().uuid(), option }).strict(),
  z.object({ kind: z.literal("add_sourced_option"), questionId: z.string().uuid(), option, url: PollCommunicationSchema.shape.links.element.shape.url }).strict(),
  messageLinkOperation,
  z.object({ kind: z.literal("remove_option"), optionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("remove_question"), questionId: z.string().uuid() }).strict(),
  ...pollQuestionOperations,
]);
export const CoordinatorProposalReplySchema = ReviewReplySchema.extend({ operations: z.array(CoordinatorOperationSchema).max(12) });

/** Pure preparation only. Persistence and explicit approval belong to the caller. */
export function prepareCoordinatorProposal(before: PollWorkingData, raw: unknown, prompt: string, at: string, suppliedPriceText = prompt) {
  const { operations, ...reply } = CoordinatorProposalReplySchema.parse(raw);
  if (before.questions.some(question => question.kind !== "choice" && question.kind !== "text") && (operations.length || reply.edits.length)) throw new Error("This editing format does not support grouped responses, rankings or points. Edit these questions through their recipe.");
  if (before.questions.some(question => question.kind === "choice" && question.itinerary) && (operations.length || reply.edits.length)) throw new Error("Edit itinerary items directly in the itinerary pane. Its versioned feedback structure stays fixed.");
  const titleOnly = /\b(?:title only|only (?:the )?(?:poll )?title|just (?:the )?(?:poll )?title)\b/i.test(prompt);
  if (titleOnly && (operations.length || reply.edits.length || reply.intro !== null || reply.message !== null)) throw new Error("A title-only request cannot change other draft fields.");
  if (/\b(?:shorter|shorten|condense|trim|tighten)\b/i.test(prompt) && /\bintro(?:duction)?\b/i.test(prompt)
    && reply.intro !== null && reply.intro.trim().length >= (before.intro ?? "").trim().length) throw new Error("The proposed introduction must be shorter than the saved introduction.");
  const candidate = structuredClone(before);
  // Only the current organizer request supplies new facts, never retrieved pages,
  // prior conversation or model output. This is still a proposal requiring Apply.
  const suppliedUrls = new Set(prompt.match(/https?:\/\/[^\s<>"“”]+/g)?.map(value => value.replace(/[.,;!?)]+$/, "")) ?? []);
  const checkUrl = (url: string) => {
    if (!suppliedUrls.has(url)) throw new Error("Supply the hotel link in your message before adding it.");
  };
  for (const operation of operations) {
    if (operation.kind === "add_message_link") {
      checkUrl(operation.link.url);
      if (!candidate.communication) throw new Error("This draft needs a group message.");
      if (!candidate.communication.links.some(link => link.url === operation.link.url)) candidate.communication.links.push(operation.link);
    } else if (operation.kind === "add_text_question") {
      candidate.questions.push({ id: randomUUID(), kind: "text", required: operation.required, prompt: operation.prompt });
    } else if (operation.kind === "add_workflow_question") {
      for (const item of operation.options) if (item.url) checkUrl(item.url);
      candidate.questions.push({ id: randomUUID(), kind: "choice", required: true, prompt: operation.prompt,
        selectionMode: operation.selectionMode, options: operation.options.map(value => ({ ...value, id: randomUUID() })) });
    } else if (operation.kind === "add_question" || operation.kind === "add_optional_question") {
      candidate.questions.push({ id: randomUUID(), kind: "choice", required: operation.kind === "add_question", prompt: operation.prompt,
        selectionMode: operation.selectionMode, options: operation.options.map(value => ({ ...value, id: randomUUID(), exclusive: false })) });
    } else if (operation.kind === "remove_question") {
      const index = candidate.questions.findIndex(value => value.id === operation.questionId);
      if (index < 0) throw new Error("That question is no longer in this draft.");
      candidate.questions.splice(index, 1);
    } else if (operation.kind === "add_option" || operation.kind === "add_sourced_option") {
      const question = candidate.questions.find(value => value.id === operation.questionId);
      if (!question || question.kind !== "choice") throw new Error("Choose a choice question for that option.");
      if (operation.kind === "add_sourced_option") checkUrl(operation.url);
      const added = { ...operation.option, id: randomUUID(), exclusive: false,
        ...(operation.kind === "add_sourced_option" ? { url: operation.url } : {}) };
      // Keep “none of these” exclusive answers at the end of the choice list.
      const exclusiveIndex = question.options.findIndex(value => value.exclusive);
      question.options.splice(exclusiveIndex < 0 ? question.options.length : exclusiveIndex, 0, added);
    } else {
      const question = candidate.questions.find(value => value.kind === "choice" && value.options.some(item => item.id === operation.optionId));
      if (!question || question.kind !== "choice") throw new Error("That option is no longer in this draft.");
      question.options = question.options.filter(value => value.id !== operation.optionId);
    }
  }
  if (operations.length && (!candidate.questions.length || candidate.questions.some(value => value.kind === "choice" && value.options.length < 2))) {
    throw new Error("Keep at least one question and two options per choice question.");
  }
  const ids = candidate.questions.flatMap(value => [value.id, ...(value.kind === "choice" ? value.options.map(item => item.id) : [])]);
  const originalIds = before.questions.flatMap(value => [value.id, ...(value.kind === "choice" ? value.options.map(item => item.id) : [])]);
  // Guided polls intentionally reuse a property/alternative identity across
  // feasibility and preference questions. A wording-only edit preserves that.
  if (new Set(ids).size !== ids.length && (operations.length || reply.edits.length || JSON.stringify(ids) !== JSON.stringify(originalIds))) throw new Error("Draft identifiers must be unique.");
  // Inference preserves old links; merge only the validated link operations.
  if (reply.message) {
    if (JSON.stringify(reply.message.links) !== JSON.stringify(before.communication?.links ?? [])) throw new Error("Keep the reviewed source links unchanged.");
    reply.message.links = candidate.communication?.links ?? [];
  }
  const next = applyReviewReply(PollWorkingDataSchema.parse(candidate), reply, prompt, at, suppliedPriceText);
  // Structural edits must pass the same price guard as wording edits, against the ORIGINAL draft.
  const supplied = new Set(reviewPriceTokens(JSON.stringify(reviewCheckpoint(before)) + suppliedPriceText));
  if (reviewPriceTokens(JSON.stringify(reviewCheckpoint(next))).some(value => !supplied.has(value))) throw new Error("A new price needs a verified source, not an AI edit.");
  const changes = reviewChanges(before, next);
  if (next.review) {
    next.review.previous = changes.length ? reviewCheckpoint(before) : before.review?.previous ?? null;
    next.review.lastChange = changes.length ? `Updated ${changes.join(", ")}.` : "Answered your question. The draft is unchanged.";
    next.review.messages = before.review?.messages ?? [];
  }
  return { data: PollWorkingDataSchema.parse(next), changes };
}
