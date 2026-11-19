import { PollCommunicationSchema, PollWorkingDataSchema, type PollWorkingData } from "@commons/contracts";
import { z } from "zod";

export const ReviewReplySchema = z.object({
  reply: z.string().min(1).max(4000),
  title: z.string().min(1).max(120).nullable(),
  intro: z.string().max(500).nullable(),
  message: PollCommunicationSchema.nullable(),
  edits: z.array(z.object({ id: z.string().uuid(), field: z.enum(["prompt", "label", "description"]), value: z.string().max(240) })).max(30),
}).strict();
// The model edits prose, not source URLs. Provider JSON Schema supports fewer
// formats than our domain validator; validate UUIDs only after receiving output.
export const ReviewProviderReplySchema = ReviewReplySchema.extend({
  message: PollCommunicationSchema.omit({ links: true }).nullable(),
  edits: z.array(z.object({ id: z.string().min(1).max(36), field: z.enum(["prompt", "label", "description"]), value: z.string().max(240) })).max(30),
});

export function reviewCheckpoint(data: PollWorkingData) {
  return { title: data.title, intro: data.intro, communication: data.communication, questions: data.questions };
}

export function reviewChanges(before: PollWorkingData, after: PollWorkingData) {
  return (["title", "intro", "communication", "questions", "audience"] as const)
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(key => ({ title: "poll title", intro: "poll introduction", communication: "group message", questions: "poll questions", audience: "recipients" })[key]);
}

/** Sentence/list punctuation is not part of a supplied amount. Decimal cents and thousands separators stay intact. */
export function reviewPriceTokens(text: string) {
  return (text.match(/(?:[$€£]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|EUR|GBP|dollars|euros|pounds))/gi) ?? [])
    .map(value => value.toLowerCase().replace(/[.,]+$/, ""));
}

export function applyReviewReply(data: PollWorkingData, raw: unknown, prompt: string, at: string, suppliedPriceText = "") {
  const reply = ReviewReplySchema.parse(raw);
  if (data.questions.some(question => question.kind !== "choice" && question.kind !== "text") && reply.edits.length) throw new Error("This editing format does not support grouped responses, rankings or points. Edit these questions through their recipe.");
  const next = structuredClone(data);
  if (reply.title !== null) next.title = reply.title;
  if (reply.intro !== null) next.intro = reply.intro;
  if (reply.message) {
    // The conversation cannot invent new source links or replace reviewed sources.
    if (JSON.stringify(reply.message.links) !== JSON.stringify(data.communication?.links ?? [])) throw new Error("Keep the reviewed source links unchanged.");
    next.communication = reply.message;
  }
  for (const edit of reply.edits) {
    const question = next.questions.find(item => item.id === edit.id);
    if (edit.field === "prompt" && question) { question.prompt = edit.value; continue; }
    const option = next.questions.flatMap(item => item.kind === "choice" ? item.options : []).find(item => item.id === edit.id);
    if (option && edit.field !== "prompt") { option[edit.field] = edit.value; continue; }
    throw new Error("The suggested edit does not match this draft.");
  }
  const supplied = new Set(reviewPriceTokens(JSON.stringify(reviewCheckpoint(data)) + suppliedPriceText));
  if (reviewPriceTokens(JSON.stringify(reviewCheckpoint(next))).some(value => !supplied.has(value))) throw new Error("A new price needs a verified source, not an AI edit.");
  const changes = reviewChanges(data, next);
  next.review = {
    messages: [...(data.review?.messages ?? []), { role: "user" as const, text: prompt, at }, { role: "assistant" as const, text: reply.reply, at }].slice(-40),
    previous: changes.length ? reviewCheckpoint(data) : data.review?.previous ?? null,
    lastChange: changes.length ? `Updated ${changes.join(", ")}.` : "Answered your question. The draft is unchanged.",
  };
  return PollWorkingDataSchema.parse(next);
}
