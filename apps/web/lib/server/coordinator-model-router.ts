import { observeAiCall, type AiObserver } from './ai-observability';
import { z } from "zod";

export const CoordinatorTaskSchema = z.enum([
  "conversation_or_guidance",
  "artifact_creation_or_edit",
  "research_synthesis",
  "introduction_bridge_edit",
  "published_workflow",
  "ambiguous_edit",
  "consequential_action",
  "invalid_destructive_edit",
]);
export type CoordinatorTask = z.infer<typeof CoordinatorTaskSchema>;

const JevChoiceSchema = z.object({
  type: z.literal("choice"),
  choice: CoordinatorTaskSchema,
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});
const JevResponseSchema = z.object({
  model: z.string(),
  answers: z.object({ task: JevChoiceSchema }),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).optional(),
});

export type CoordinatorRouteInput = {
  prompt: string;
  hasDraft: boolean;
  questionCount: number;
  selectedPublishedPoll: boolean;
  researchStatus?: "complete" | "partial" | "unavailable";
};
export type CoordinatorRouteConfiguration = {
  telemetry?: AiObserver;
  mode?: "single" | "jev";
  typesafeApiKey?: string;
  typesafeModel?: string;
  baselineModel: string;
  miniModel: string;
  sparkModel: string;
  baselineProviderPolicy: "private" | "standard";
  sparkProviderPolicy: "private" | "standard";
  minimumConfidence?: number;
};
export type CoordinatorModelRoute = {
  model: string;
  providerPolicy: "private" | "standard";
  handler: "model" | "invalid_destructive_edit";
  task: CoordinatorTask | "single_model" | "router_unavailable" | "low_confidence" | "known_published_state" | "known_research_state";
  confidence?: number;
};

function baseline(configuration: CoordinatorRouteConfiguration, task: CoordinatorModelRoute["task"]): CoordinatorModelRoute {
  return { model: configuration.baselineModel, providerPolicy: configuration.baselineProviderPolicy, handler: "model", task };
}

export function routeForTask(task: CoordinatorTask, confidence: number, configuration: CoordinatorRouteConfiguration): CoordinatorModelRoute {
  const minimumConfidence = configuration.minimumConfidence ?? 0.55;
  if (confidence < minimumConfidence) return baseline(configuration, "low_confidence");
  if (task === "invalid_destructive_edit") {
    return { model: configuration.miniModel, providerPolicy: configuration.baselineProviderPolicy, handler: "invalid_destructive_edit", task, confidence };
  }
  if (["published_workflow", "ambiguous_edit", "consequential_action"].includes(task)) {
    return { model: configuration.miniModel, providerPolicy: configuration.baselineProviderPolicy, handler: "model", task, confidence };
  }
  return { model: configuration.sparkModel, providerPolicy: configuration.sparkProviderPolicy, handler: "model", task, confidence };
}

async function selectCoordinatorModelInternal(
  input: CoordinatorRouteInput,
  configuration: CoordinatorRouteConfiguration,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<CoordinatorModelRoute> {
  if (configuration.mode !== "jev") return baseline(configuration, "single_model");
  // Research is already scoped evidence supplied by Commons. Keep synthesis and
  // follow-up questions with the evidence-capable model, including unavailable
  // research. This takes precedence over a selected published poll.
  if (input.researchStatus) {
    return { model: configuration.sparkModel, providerPolicy: configuration.sparkProviderPolicy, handler: "model", task: "known_research_state" };
  }
  // This state is already known by Commons. Do not spend a model call rediscovering it.
  if (!input.hasDraft && input.selectedPublishedPoll) {
    return { model: configuration.miniModel, providerPolicy: configuration.baselineProviderPolicy, handler: "model", task: "known_published_state" };
  }
  const apiKey = configuration.typesafeApiKey?.trim();
  if (!apiKey) return baseline(configuration, "router_unavailable");
  try {
    const response = await fetcher("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      signal: AbortSignal.any([AbortSignal.timeout(3_000), ...(signal ? [signal] : [])]),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: configuration.typesafeModel ?? "jev-latest",
        state: {
          request: input.prompt,
          workspace: {
            editable_draft_selected: input.hasDraft,
            question_count: input.questionCount,
            published_poll_selected: input.selectedPublishedPoll,
            research_status: input.researchStatus ?? "none",
          },
        },
        questions: {
          task: {
            type: "choice",
            instructions: "Classify the organizer's immediate request by the single handler best suited to answer it. Use workspace state only to disambiguate what can be edited. Do not infer trip facts.",
            criteria: {
              conversation_or_guidance: "Advice, explanation, next-step guidance, or ordinary trip-planning conversation that does not primarily edit an artifact.",
              artifact_creation_or_edit: "Create or revise a poll, question, option, title, delivery message, or other participant-facing artifact; includes exact wording edits except introduction-only bridge edits.",
              research_synthesis: "Compare, summarize, or explain supplied research evidence, or help frame a further research task.",
              introduction_bridge_edit: "Revise only the poll introduction that bridges confirmed prior decisions to the current question.",
              published_workflow: "Discuss what to do with an already-published poll or a request to edit a published artifact when no editable draft is selected.",
              ambiguous_edit: "An edit request whose target or intended replacement is unclear and requires a clarifying question.",
              consequential_action: "A request to publish, send, invite, change recipients, book, pay, charge, or otherwise perform an external consequential action.",
              invalid_destructive_edit: "A request that would remove every question or option, or otherwise leave the poll structurally invalid.",
            },
          },
        },
      }),
    });
    if (!response.ok) return baseline(configuration, "router_unavailable");
    const answer = JevResponseSchema.parse(await response.json()).answers.task;
    return routeForTask(answer.choice, answer.confidence, configuration);
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("commons.coordinator.router_failed", {
      kind: error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : error instanceof z.ZodError ? "invalid_response" : "transport",
    });
    return baseline(configuration, "router_unavailable");
  }
}

export function invalidDestructiveEditReply() {
  return {
    reply: "A poll needs at least one question with a usable response path. I can remove a specific question or option, or help replace this poll with a simpler one, but I won’t leave the draft empty.",
    title: null,
    intro: null,
    message: null,
    edits: [],
    operations: [],
  } as const;
}

export async function selectCoordinatorModel(...args: Parameters<typeof selectCoordinatorModelInternal>) {
  const [input, configuration, signal, fetcher = fetch] = args;
  let result: CoordinatorModelRoute | undefined;
  const observer: AiObserver | undefined = configuration.telemetry ? generation => configuration.telemetry!({ ...generation, failed: generation.failed || result?.task === 'router_unavailable' }) : undefined;
  return observeAiCall('typesafe', configuration.typesafeModel ?? 'jev-latest', observer,
    async observed => { result = await selectCoordinatorModelInternal(input, configuration, signal, observed); return result; }, fetcher);
}
