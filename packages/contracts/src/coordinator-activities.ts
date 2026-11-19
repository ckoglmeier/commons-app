import { z } from "zod";

export const ActivityIdeaTitlesSchema = z.array(z.string().trim().min(1).max(200)).min(1).max(24);
export const ActivityIdeaReceiptSchema = z.object({
  at: z.string().datetime(),
  items: z.array(z.object({ id: z.string().uuid(), title: z.string().min(1).max(200), status: z.enum(["added", "existing"]) })).min(1).max(24),
});
export type ActivityIdeaReceipt = z.infer<typeof ActivityIdeaReceiptSchema>;
export const activityTitleKey = (title: string) => title.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

const command = /^(?:(?:can|could|would) you\s+|(?:I want you to|I'd like you to|I would like you to)\s+)?(?:please\s+)?(?:add|save|create)\s+(?:(?:these|the following)\s+)?(?:(?:as\s+)?(?:planned\s+)?(?:activity\s+|plan\s+)?ideas|activities|(?:these\s+)?as\s+activities)\s*:/i;
const error = "I couldn’t read the whole activity list, so nothing was added. Use ‘Add as ideas:’ followed by up to 24 names separated by commas or new lines. Keep dates, times and other changes separate.";

/** Only explicit title lists. No model output, inferred dates, confirmation, or history can authorize a write. */
export function parseOrganizerActivities(text: string): { titles: string[]; error: string | null } | null {
  const trimmed = text.trim(), match = command.exec(trimmed);
  if (!match) return null;
  const list = trimmed.slice(match[0].length).trim().replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/gm, "");
  if (!list) return { titles: [], error: "List the activities after ‘Add as ideas:’. Nothing was added." };
  const entries: string[] = [];
  let value = "", quoted = false;
  for (let index = 0; index < list.length; index += 1) {
    const char = list[index];
    if (char === '"') {
      if (quoted && list[index + 1] === '"') { value += '"'; index += 1; }
      else if (quoted || !value.trim()) quoted = !quoted;
      else value += char;
    } else if (!quoted && /[,;\n]/.test(char)) {
      if (value.trim()) entries.push(value.trim());
      else if (char !== "\n") return { titles: [], error };
      value = "";
    } else value += char;
  }
  if (quoted || !value.trim()) return { titles: [], error };
  entries.push(value.trim());
  const titles = entries.map(entry => entry.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, "").replace(/\s+/g, " ").trim());
  // Mixed instructions need their normal review flow; this command saves titles only.
  const details = /\b(?:on|at|for|by|after|before)\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|today|tomorrow|January|February|March|April|May|June|July|August|September|October|November|December|\d)|\b(?:if|then|instead|once|when|until|later)\b|[?@]|https?:\/\/|\b(?:update|change|set|mark|assign|move|add|create|save|make|attach|link|promote|defer|hold|book|reserve|pay|send|invite|confirm(?:ed)?|schedule(?:d)?|cancel|delete|remove|research|look up|tomorrow|later|unless|except|don't|do not|not yet)\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b/i;
  if (titles.some(title => details.test(title)) || !ActivityIdeaTitlesSchema.safeParse(titles).success) return { titles: [], error };
  return { titles: [...new Map(titles.map(title => [activityTitleKey(title), title])).values()], error: null };
}
