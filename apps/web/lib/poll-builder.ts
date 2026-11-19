import { CreatePollRequestSchema, type PollQuestion, type PollOption } from "@commons/contracts";

export function newPollOption(label = ""): PollOption {
  return { id: crypto.randomUUID(), label, description: null, exclusive: false, url: null, resource: null };
}
export function newPollQuestion(kind: "choice" | "text" = "choice", prompt = ""): PollQuestion {
  const base = { id: crypto.randomUUID(), prompt, required: kind === "choice" };
  return kind === "text" ? { ...base, kind } : { ...base, kind, selectionMode: "multiple", options: [newPollOption(), newPollOption()] };
}
export function movePollQuestion(questions: PollQuestion[], index: number, direction: -1 | 1) {
  const next = index + direction;
  if (next < 0 || next >= questions.length) return questions;
  const reordered = [...questions];
  [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
  return reordered;
}
export function pollDraftError(value: unknown): string | null {
  const result = CreatePollRequestSchema.safeParse(value);
  return result.success ? null : result.error.issues[0]?.message ?? "Check the questions and options.";
}
/** Manual starting point, not inferred facts or a model response. */
export function housingConceptQuestion(): PollQuestion {
  return { id: crypto.randomUUID(), kind: "choice", prompt: "Which kinds of stay could work for you?", required: true,
    selectionMode: "multiple", options: [
      { ...newPollOption("A shared house"), description: "Shared living space and a kitchen. Illustrative concept, not a property or quote." },
      { ...newPollOption("A small hotel"), description: "Separate rooms with a shared place to meet. Illustrative concept, not a property or quote." },
      { ...newPollOption("A full-service resort"), description: "On-site food and amenities. Illustrative concept, not a property or quote." },
      { ...newPollOption("None of these works"), exclusive: true },
    ] };
}
