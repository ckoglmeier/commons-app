import { readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";

/*
 * Coordinator inference policies: the one place that decides which provider carries a model call, which model serves each kind of task, whether a
 * routing classifier may run, how data is handled, and who pays (R8; docs/COORDINATOR-PERFORMANCE-REVIEW.md §2b). Authorization, trip scope, the
 * honesty guard and approvals never depend on the policy.
 *
 * - `best` (the rollback): Commons' best and least expensive qualified path, through OpenRouter with zero data retention by default. Any configured model and the
 *   optional Jev classifier. Commons-funded (free today; may later sit behind a Commons subscription).
 * - `openai` (the default since September 30): OpenAI models only, called directly at OpenAI, routed by Commons' own rules with no classifier or other provider. Commons-funded today;
 *   this is the path a person's own ChatGPT plan can fund once Sign in with ChatGPT plan sharing is available to Commons. A plan-funded call must never
 *   fall back to Commons funding or another paid option without the organizer choosing it.
 *
 * To change a policy: edit its entry below (and bump COORDINATOR_POLICY_VERSION), check GET /api/v1/admin/coordinator-policy, run
 * scripts/qa/coordinator-turn-benchmark.ts --policy=<id>, then switch COMMONS_COORDINATOR_INFERENCE_POLICY. A future provider-specific policy (for
 * example Sign in with Claude) is a new entry; the turn path does not change.
 */

export const COORDINATOR_POLICY_VERSION = 3;

type Environment = ReturnType<typeof readCommonsRuntimeEnvironment>;
export type InferencePolicyId = "best" | "openai" | "openai-luna-none";
export type InferenceTransport = "openrouter" | "openai";
/** conversation: ordinary answers and synthesis; extraction: bounded structured work and grounded retrieval; escalation: the hard-case model. */
export type InferenceTier = "conversation" | "extraction" | "planning" | "escalation";

type PolicyDefinition = {
  id: InferencePolicyId; label: string; summary: string;
  transport: InferenceTransport;
  /** Where data goes and under which retention terms. */
  dataHandling: string;
  /** Who pays. Only Commons today; a delegated `user_plan` is resolved per organizer when it exists. */
  fundingSource: "commons";
  models: (environment: Environment) => Record<InferenceTier, string>;
  /** Whether the Jev classifier may choose among models (still only when routing mode is jev and its key is set). */
  classifierAllowed: boolean;
  /** Models this policy may run, as configured ids. */
  allows: (configured: string) => boolean;
  credential: (environment: Environment) => string | undefined;
};

const POLICIES: Record<InferencePolicyId, PolicyDefinition> = {
  best: {
    id: "best", label: "Best available", summary: "Least expensive qualified model for each task, through OpenRouter.",
    transport: "openrouter", fundingSource: "commons", classifierAllowed: true,
    dataHandling: "OpenRouter with zero data retention and no data collection (COMMONS_COORDINATOR_PROVIDER_POLICY=private); the optional Spark route uses its own provider policy.",
    models: environment => ({ conversation: environment.COMMONS_WORKSPACE_MODEL, extraction: environment.COMMONS_WORKSPACE_MINI_MODEL, planning: environment.COMMONS_COORDINATOR_PLANNING_MODEL, escalation: environment.COMMONS_COORDINATOR_ADVISORY_MODEL }),
    allows: () => true,
    credential: environment => environment.OPENROUTER_API_KEY,
  },
  openai: {
    id: "openai", label: "OpenAI only", summary: "OpenAI models called directly at OpenAI; the path a person's ChatGPT plan can fund later.",
    transport: "openai", fundingSource: "commons", classifierAllowed: false,
    dataHandling: "OpenAI API directly, under the OpenAI organization's retention settings (abuse-monitoring retention unless zero data retention is approved for the organization).",
    models: environment => ({ conversation: environment.COMMONS_OPENAI_POLICY_MODEL, extraction: environment.COMMONS_OPENAI_POLICY_MINI_MODEL, planning: environment.COMMONS_OPENAI_POLICY_PLANNING_MODEL, escalation: environment.COMMONS_OPENAI_POLICY_ESCALATION_MODEL }),
    allows: configured => configured.startsWith("openai/"),
    credential: environment => environment.OPENAI_API_KEY,
  },
  "openai-luna-none": {
    id: "openai-luna-none", label: "Luna none", summary: "Direct OpenAI Luna with explicit none reasoning for ordinary conversation and bounded classifiers. Planning and escalation use their configured models.",
    transport: "openai", fundingSource: "commons", classifierAllowed: false,
    dataHandling: "OpenAI API directly, under the OpenAI organization's retention settings.",
    models: environment => ({ conversation: "openai/gpt-6-luna", extraction: "openai/gpt-6-luna", planning: environment.COMMONS_OPENAI_POLICY_PLANNING_MODEL, escalation: environment.COMMONS_OPENAI_POLICY_ESCALATION_MODEL }),
    allows: configured => configured.startsWith("openai/"),
    credential: environment => environment.OPENAI_API_KEY,
  },
};

export type InferencePolicy = {
  id: InferencePolicyId; version: number; transport: InferenceTransport; fundingSource: "commons"; apiKey: string;
  routingMode: "single" | "jev";
  models: Record<InferenceTier, string>;
  /** The provider's id for a configured model, or null when this policy cannot run it. */
  modelId: (configured: string) => string | null;
};

function providerModelId(definition: PolicyDefinition, configured: string) {
  if (!definition.allows(configured)) return null;
  // Configuration keeps OpenRouter-style ids ("openai/gpt-4.1-mini"); OpenAI's own API takes them without the prefix.
  return definition.transport === "openai" ? configured.slice("openai/".length) : configured;
}

function gapsOf(definition: PolicyDefinition, environment: Environment) {
  const models = definition.models(environment);
  return [
    ...(definition.credential(environment) ? [] : [`${definition.transport === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY"} is not set`]),
    ...Object.entries(models).filter(([, model]) => !definition.allows(model)).map(([tier, model]) => `${tier} model ${model} is not allowed by this policy`),
  ];
}

/** The active policy, ready to call, or null when it cannot run (missing key or a model the policy does not allow). */
export function coordinatorInferencePolicy(environment = readCommonsRuntimeEnvironment(), id: InferencePolicyId = environment.COMMONS_COORDINATOR_INFERENCE_POLICY): InferencePolicy | null {
  if (environment.COMMONS_COORDINATOR_TEXT_DISABLED === "true") return null;
  const definition = POLICIES[id], apiKey = definition.credential(environment);
  if (!apiKey || gapsOf(definition, environment).length) return null;
  return {
    id, version: COORDINATOR_POLICY_VERSION, transport: definition.transport, fundingSource: definition.fundingSource, apiKey,
    routingMode: definition.classifierAllowed ? environment.COMMONS_WORKSPACE_ROUTING_MODE : "single",
    models: definition.models(environment),
    modelId: configured => providerModelId(definition, configured),
  };
}

/** Text conversation is available when the active policy can run. */
export function coordinatorConversationConfigured(environment = readCommonsRuntimeEnvironment()) {
  return coordinatorInferencePolicy(environment) !== null;
}

/** Every policy as it would resolve now, for the operator endpoint and tests. Never includes credentials. */
export function describeCoordinatorPolicies(environment = readCommonsRuntimeEnvironment()) {
  const active = environment.COMMONS_COORDINATOR_INFERENCE_POLICY;
  return {
    version: COORDINATOR_POLICY_VERSION, active, textDisabled: environment.COMMONS_COORDINATOR_TEXT_DISABLED === "true",
    policies: Object.values(POLICIES).map(definition => {
      const models = definition.models(environment), gaps = gapsOf(definition, environment);
      return {
        id: definition.id, label: definition.label, summary: definition.summary, active: definition.id === active, ready: gaps.length === 0, gaps,
        transport: definition.transport, fundingSource: definition.fundingSource, dataHandling: definition.dataHandling,
        ...(definition.id === "openai-luna-none" ? { reasoning: "none", excluded: ["research-decision specialist", "OpenRouter"] } : {}),
        routing: definition.classifierAllowed && environment.COMMONS_WORKSPACE_ROUTING_MODE === "jev" ? (environment.TYPESAFE_API_KEY ? "jev classifier" : "jev requested, no TypeSafe key: baseline model") : "Commons rules only",
        models: Object.fromEntries(Object.entries(models).map(([tier, model]) => [tier, { configured: model, providerModel: providerModelId(definition, model) }])),
        ...(definition.classifierAllowed && environment.COMMONS_WORKSPACE_ROUTING_MODE === "jev" ? { classifierModels: { spark: environment.COMMONS_WORKSPACE_SPARK_MODEL, sparkDataPolicy: environment.COMMONS_WORKSPACE_SPARK_PROVIDER_POLICY } } : {}),
      };
    }),
  };
}
