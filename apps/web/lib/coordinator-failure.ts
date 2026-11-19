import { CoordinatorErrorCodeSchema } from "@commons/contracts";

/** Fixed diagnostic codes only: never return arbitrary exception text or model output. */
export function coordinatorFailureCode(error: unknown): string {
  const known = new Map([
    ["Supply the hotel link in your message before adding it.", "source_required"],
    ["This draft needs a group message.", "message_missing"],
    ["That question is no longer in this draft.", "question_missing"],
    ["Choose a choice question for that option.", "choice_missing"],
    ["That option is no longer in this draft.", "option_missing"],
    ["Keep at least one question and two options per choice question.", "incomplete_choices"],
    ["Draft identifiers must be unique.", "duplicate_ids"],
    ["Keep the reviewed source links unchanged.", "links_changed"],
    ["A new price needs a verified source, not an AI edit.", "price_unsourced"],
    ["The suggested edit does not match this draft.", "edit_target_missing"],
  ]);
  if (!(error instanceof Error)) return "unknown";
  // Stable coordinator codes (turn lifecycle, access, and version errors) are already fixed strings.
  const stable = CoordinatorErrorCodeSchema.safeParse((error as { coordinatorCode?: unknown }).coordinatorCode ?? (error as { code?: unknown }).code);
  if (stable.success) return stable.data;
  return known.get(error.message) ?? (error.name === "ZodError" ? "schema_invalid" : error.name === "TypeError" ? "type_error" : "unknown");
}
