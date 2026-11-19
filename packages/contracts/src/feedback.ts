import { z } from "zod";

export const DemoFeedbackAnswersSchema = z.object({
  firstTrip: z.string().trim().min(1).max(2_000),
  biggestHelp: z.string().trim().min(1).max(2_000),
  trustOrClarity: z.string().trim().min(1).max(2_000),
  nextCapability: z.string().trim().min(1).max(2_000),
});

export const SubmitDemoFeedbackRequestSchema = z.object({
  commonsSlug: z.string().trim().min(1).max(120),
  source: z.enum(["walkthrough", "feedback_button"]),
  questionVersion: z.literal(1),
  respondentName: z.string().trim().max(120).optional(),
  answers: DemoFeedbackAnswersSchema,
  pagePath: z.string().trim().min(1).max(200).startsWith("/"),
  idempotencyKey: z.uuid(),
  website: z.string().max(200).optional(),
});

export type DemoFeedbackAnswers = z.infer<typeof DemoFeedbackAnswersSchema>;
export type SubmitDemoFeedbackRequest = z.infer<typeof SubmitDemoFeedbackRequestSchema>;

// Keep credential-bearing links and arbitrary query strings out of support records.
export function feedbackPagePath(value: string): string {
  let url: URL;
  try { url = new URL(value, "https://commons.invalid"); }
  catch { return "/"; }
  if (url.origin !== "https://commons.invalid") return "/";
  if (/^\/(join|poll|auth)(\/|$)/.test(url.pathname)) return `/${url.pathname.split("/")[1]}`;
  if (url.pathname.startsWith("/c/poll/")) return "/c/poll";
  const view = url.searchParams.get("view");
  return url.pathname + (view && ["home", "plan", "logistics", "money", "moments"].includes(view) ? `?view=${view}` : "");
}

export const ProductFeedbackAnswersSchema = z.object({
  category: z.enum(["problem", "suggestion"]),
  message: z.string().trim().min(1).max(2_000),
});

export const SubmitProductFeedbackRequestSchema = SubmitDemoFeedbackRequestSchema.extend({
  source: z.enum(["walkthrough", "feedback_button"]),
  questionVersion: z.literal(2),
  answers: ProductFeedbackAnswersSchema,
  pagePath: z.string().trim().min(1).max(200).startsWith("/").transform(feedbackPagePath),
});

// Version 1 remains readable for existing records and previously loaded clients.
export const SubmitFeedbackRequestSchema = z.discriminatedUnion("questionVersion", [
  SubmitDemoFeedbackRequestSchema,
  SubmitProductFeedbackRequestSchema,
]);

export type ProductFeedbackAnswers = z.infer<typeof ProductFeedbackAnswersSchema>;
export type SubmitFeedbackRequest = z.infer<typeof SubmitFeedbackRequestSchema>;
