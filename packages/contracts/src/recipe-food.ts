import { z } from "zod";
import { MAX_POLL_QUESTIONS, type PollAnswer, type PollQuestion, type PollWorkingData } from "./poll";

export const foodQuestions = [
  { key: "requirements", prompt: "Anything you can’t eat? Allergies or dietary restrictions." },
  { key: "preferences", prompt: "What do you enjoy or avoid?" },
  { key: "notes", prompt: "Anything else for planning meals?" },
] as const;
export const FoodQuestionInputSchema = z.object({
  id: z.string().uuid(), prompt: z.string().trim().min(1).max(240), required: z.boolean(),
  foodField: z.enum(["requirements", "preferences", "notes"]),
}).strict();
const foodQuestionInputs = z.array(FoodQuestionInputSchema).min(1).max(MAX_POLL_QUESTIONS)
  .refine(questions => new Set(questions.map(q => q.id)).size === questions.length, "Each question needs a unique ID.");
export function buildFoodPollData(input: { title?: string; intro?: string | null; questions?: z.infer<typeof foodQuestionInputs>; previous?: PollWorkingData | null }): PollWorkingData {
  return { title: input.title?.trim() || input.previous?.title || "Food preferences",
    intro: input.intro !== undefined ? input.intro : input.previous ? input.previous.intro : "Help us plan meals everyone can enjoy.", ballotMode: "transparent",
    // Title-only saves and revisions preserve custom wording, order and identities.
    questions: input.questions ? input.questions.map(q => ({ ...q, kind: "text" as const, organizerOnly: true })) : input.previous?.questions ?? foodQuestions.map(({ key, prompt }) => ({ id: crypto.randomUUID(), kind: "text" as const, prompt, required: false, foodField: key, organizerOnly: true })) };
}
export const FoodSummarySchema = z.object({
  responseCount: z.number().int().nonnegative(),
  entries: z.array(z.object({ responseId: z.string().uuid(), name: z.string(), requirements: z.string().nullable(), preferences: z.string().nullable(), notes: z.string().nullable() })),
});
export type FoodSummary = z.infer<typeof FoodSummarySchema>;
/** A live view of saved answers, not an approval or a separate copy of the outcome. */
export function summarizeFoodResponses(questions: PollQuestion[], rows: Array<{ id: string; name: string; answers: PollAnswer[] }>): FoodSummary {
  return { responseCount: rows.length, entries: rows.map(row => {
    const read = (field: "requirements" | "preferences" | "notes") => {
      const matching = questions.filter(q => q.kind === "text" && (q.foodField ?? "notes") === field);
      return matching.flatMap(q => {
        const text = row.answers.find(a => a.questionId === q.id)?.text?.trim();
        return text ? [matching.length > 1 ? `${q.prompt}: ${text}` : text] : [];
      }).join("\n") || null;
    };
    return { responseId: row.id, name: row.name, requirements: read("requirements"), preferences: read("preferences"), notes: read("notes") };
  }) };
}
export const FoodOutcomeSchema = z.object({ kind: z.literal("food_preferences"), summary: FoodSummarySchema }).strict();
export const StartFoodRunSchema = z.object({ commandId: z.string().uuid(), runId: z.string().uuid(), draftId: z.string().uuid(), recipe: z.literal("food_preferences"), title: z.string().trim().max(120).optional() }).strict();
export const SaveFoodSchema = z.object({ commandId: z.string().uuid(), expectedDraftVersion: z.number().int().positive(), title: z.string().trim().min(1).max(120).optional(), intro: z.string().trim().max(500).nullable().optional(), questions: foodQuestionInputs.optional() }).strict();
export const ApproveFoodSchema = z.object({ commandId: z.string().uuid(), pollId: z.string().uuid(), evidenceFingerprint: z.string().length(64), uncertaintyAcknowledged: z.literal(true), needResolutions: z.array(z.object({ responseId: z.string().uuid(), questionId: z.string().uuid(), resolution: z.string().trim().min(1).max(500) }).strict()).max(200).default([]) }).strict();
