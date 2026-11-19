import { z } from "zod";
import { MAX_POLL_QUESTIONS } from "./poll-limits";

export const MAX_RECIPE_COMBINATIONS = 10;
const ConfigurationOptionSchema = z.object({ id: z.string().uuid(), label: z.string().trim().max(160).optional(), startsOn: z.iso.date().optional(), endsOn: z.iso.date().optional(), place: z.string().trim().min(1).max(60).optional() }).strict();
export const DatesLocationBlockSchema = z.object({
  id: z.string().uuid(), type: z.enum(["dates", "location", "combination", "ranking", "allocation", "text", "choice"]),
  scale: z.enum(["interest", "yes_maybe_no"]).optional(), selectionMode: z.enum(["single", "multiple"]).optional(),
  dimension: z.enum(["dates", "location", "combination"]).optional(),
  prompt: z.string().trim().min(1).max(240), required: z.boolean(),
  options: z.array(ConfigurationOptionSchema).max(MAX_RECIPE_COMBINATIONS),
}).strict().superRefine((block, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (block.type === "text") { if (block.options.length || block.dimension) issue("Written questions do not have options or a dimension."); return; }
  if (block.options.length < 2) issue("Add at least two options to each selected question.");
  if (new Set(block.options.map(option => option.id)).size !== block.options.length) issue("Each option needs its own identifier.");
  if (block.type === "choice") {
    if (!block.selectionMode || block.dimension || block.scale) issue("Choose single or multiple selection for a simple choice question.");
    if (block.options.some(option => !option.label?.trim() || option.place || option.startsOn || option.endsOn)) issue("Simple choices need labels without dates or places.");
    if (new Set(block.options.map(option => option.label?.toLocaleLowerCase())).size !== block.options.length) issue("Each answer must be different.");
    return;
  }
  if (block.scale && block.type !== "location" || block.selectionMode) issue("That setting does not match this question format.");
  const dimension = block.type === "ranking" || block.type === "allocation" ? block.dimension : block.type;
  if (!dimension) issue("Choose what the preference options describe.");
  for (const option of block.options) {
    if (dimension === "dates" || dimension === "combination") {
      if (!option.startsOn || !option.endsOn || option.endsOn < option.startsOn) issue("Add a valid date range to every option.");
    } else if (option.startsOn || option.endsOn) issue("Place options do not have dates.");
    if (dimension === "location" || dimension === "combination") { if (!option.place) issue("Add a place to every option."); }
    else if (option.place) issue("Date options do not have a place.");
  }
  const identities = block.options.map(option => `${option.startsOn ?? ""}|${option.endsOn ?? ""}|${option.place?.toLocaleLowerCase() ?? ""}`);
  if (new Set(identities).size !== identities.length) issue("Each option must be different.");
});
export const DatesLocationConfigurationSchema = z.object({ version: z.literal(2), blocks: z.array(DatesLocationBlockSchema).min(1).max(MAX_POLL_QUESTIONS) }).strict().superRefine((value, ctx) => {
  if (value.blocks.filter(block => block.type === "combination").length > 1) ctx.addIssue({ code: "custom", message: "Use one date-and-place feasibility question per round." });
  if (new Set(value.blocks.map(block => block.id)).size !== value.blocks.length) ctx.addIssue({ code: "custom", message: "Each question needs its own identifier." });
});
export type DatesLocationConfiguration = z.infer<typeof DatesLocationConfigurationSchema>;
export type DatesLocationBlock = z.infer<typeof DatesLocationBlockSchema>;
