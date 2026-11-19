import { z } from "zod";
import { PollCommunicationSchema } from "@commons/contracts";
import { CoordinatorOptionSchema, type CoordinatorOperationSchema } from "../coordinator-proposal";
import type { PollWorkingData } from "@commons/contracts";

/** Validate explicit response structure; never invent questions or normalize
 * a provider's made-up choices into a different kind of saved question. */
export function pollConstructionMatches(request: string, data: PollWorkingData) {
  const numbers: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const counts = [...request.matchAll(/\b(?:include|ask|use|create|add)\s+(?:exactly\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[1-9]|1[0-2])\s+(?:(?:distinct|separate)\s+)?questions\b/ig)];
  const count = counts.at(-1)?.[1].toLowerCase();
  if (count && data.questions.length !== (numbers[count] ?? Number(count))) return false;
  const textRequests = [...request.matchAll(/\b(optional(?:ly)?|required)\s+(?:written|write|(?:free[- ]+)?text|open[- ]+ended)\s+(?:(?:suggestions|feedback|responses?|answers?)\s+)?(?:questions?|responses?|answers?|suggestions|feedback)\b/ig)];
  if (!textRequests.every(match => data.questions.some(question => question.kind === "text" && question.required === (match[1].toLowerCase() === "required")))) return false;
  const choiceRequests = [...request.matchAll(/\b(required|optional(?:ly)?)\s+(?:(?!\b(?:required|optional(?:ly)?)\b)[^.!?;\n:]){0,60}?(single[- ]choice|choose[- ]one|multiple[- ]choice|multi[- ](?:choice|select)|(?:choose|select|tick)[- ](?:all|any)(?:[- ]that[- ](?:work|apply))?)\b/ig)];
  return choiceRequests.every(match => data.questions.some(question => question.kind === "choice" && question.required === (match[1].toLowerCase() === "required") && question.selectionMode === (/single|one/i.test(match[2]) ? "single" : "multiple")));
}


/** Uniform fields keep first construction simple for the provider. The app
 * translates these into its existing operations, generates IDs and validates. */
export const PollConstructionQuestionSchema = z.object({
  kind: z.enum(["choice", "text"]), prompt: z.string().trim().min(1).max(240), required: z.boolean(),
  selectionMode: z.enum(["single", "multiple"]).nullable(),
  options: z.array(CoordinatorOptionSchema.extend({ exclusive: z.boolean(), url: PollCommunicationSchema.shape.links.element.shape.url.nullable() })).max(12),
}).strict();
export const PollConstructionLinksSchema = z.array(PollCommunicationSchema.shape.links.element).max(8);
export function pollConstructionOperations(questions: z.infer<typeof PollConstructionQuestionSchema>[], links: z.infer<typeof PollConstructionLinksSchema>) {
  const operations: z.infer<typeof CoordinatorOperationSchema>[] = [];
  for (const question of questions) {
    if (question.kind === "text") {
      if (question.options.length || question.selectionMode !== null) throw new Error("A written-response question needs a text input, not choices.");
      operations.push({ kind: "add_text_question", prompt: question.prompt, required: question.required });
    } else {
      if (!question.selectionMode || question.options.length < 2) throw new Error("A choice question needs at least two choices and a selection mode.");
      if (question.required) operations.push({ kind: "add_workflow_question", prompt: question.prompt, selectionMode: question.selectionMode, options: question.options });
      else {
        if (question.options.some(option => option.exclusive)) throw new Error("Optional questions need ordinary choices; no exclusive answer was saved.");
        operations.push({ kind: "add_optional_question", prompt: question.prompt, selectionMode: question.selectionMode, options: question.options.map(({ label, description }) => ({ label, description })) });
        for (const option of question.options) if (option.url) operations.push({ kind: "add_message_link", link: { label: option.label, url: option.url } });
      }
    }
  }
  for (const link of links) operations.push({ kind: "add_message_link", link });
  return operations;
}
