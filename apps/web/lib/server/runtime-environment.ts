import { z } from "zod";

const optionalUrl = z.string().url().optional();

const RuntimeEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  VERCEL: z.string().optional(),
  VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
  VERCEL_URL: z.string().min(1).optional(),
  DATABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  COMMONS_INVITATION_TOKEN_KEY: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  NEXT_PUBLIC_SITE_URL: optionalUrl,
  COMMONS_PILOT_ACTOR_ID: z.string().uuid().optional(),
  COMMONS_CONVERSATION_DIGESTS_ENABLED: z.enum(["true", "false"]).optional(),
  COMMONS_EVENT_ONBOARDING_ENABLED: z.enum(["true", "false"]).optional(),
  COMMONS_EVENT_ONBOARDING_ALLOWLIST: z.string().optional(),
  // Free beta (trip-capabilities.ts, docs/operations/FREE-BETA-ACTIVATION.md). Off by default: every real trip unchanged.
  COMMONS_CLOSED_BETA_REQUIRED: z.enum(["true", "false"]).default("true"),
  COMMONS_PUBLIC_FREE_BETA_ENABLED: z.enum(["true", "false"]).optional(),
  // Draft → approval → $20 → first invite (docs/BETA-PAYMENTS-STATUS.md). Off by default. Test-mode provider only.
  COMMONS_BETA_REWORK_ENABLED: z.enum(["true", "false"]).optional(),
  COMMONS_TRAFFIC_ALERT_FAILURES: z.string().optional(),
  COMMONS_TRAFFIC_ALERT_RESPONSES: z.string().optional(),
  COMMONS_TRAFFIC_ALERT_POLLS: z.string().optional(),
  COMMONS_TRAFFIC_ALERT_TRIPS: z.string().optional(),
  COMMONS_BETA_APPROVAL_EMAIL_ENABLED: z.enum(["true", "false"]).optional(),
  STRIPE_TEST_SECRET_KEY: z.string().optional(),
  STRIPE_TEST_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_TEST_API_BASE: z.string().optional(),
  STRIPE_TEST_PRODUCT_TAX_CODE: z.string().optional(),
  // Explicit pilots kept when the free beta is on: claimed organizer emails, and operator-listed trip ids.
  COMMONS_PILOT_ORGANIZER_EMAILS: z.string().optional(),
  COMMONS_PILOT_TRIP_IDS: z.string().optional(),
  // "false" turns poll framing help off everywhere; manual polls are unaffected.
  COMMONS_POLL_ASSISTANCE_ENABLED: z.string().optional(),
  COMMONS_OPERATOR_EMAIL_ALLOWLIST: z.string().optional(),
  COMMONS_OPERATOR_NOTIFICATION_EMAIL: z.string().email().default("organizer@example.com"),
  COMMONS_EMAIL_SEND_MODE: z.enum(["disabled", "allowlist", "production"]).optional(),
  COMMONS_EMAIL_RECIPIENT_ALLOWLIST: z.string().optional(),
  COMMONS_EMAIL_FROM: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  // No default: unset keeps paid poll help off. "auto" selects Terra low for initial framing / Luna none for revisions; a model ID pins both.
  COMMONS_POLL_MODEL: z.string().min(1).max(100).optional(),
  OPENROUTER_API_KEY: z.string().trim().min(1).optional(),
  COMMONS_REVIEW_MODEL: z.string().min(1).max(100).optional(),
  COMMONS_WORKSPACE_MODEL: z.string().min(1).max(100).default("openai/gpt-4.1-mini"),
  COMMONS_WORKSPACE_ROUTING_MODE: z.enum(["single", "jev"]).default("single"),
  // Coordinator inference policy (coordinator-inference-policy.ts): "openai" (default) = OpenAI models, direct; "best" = OpenRouter, any qualified
  // model. Set "best" to roll back. Measured: direct OpenAI streams first text 1.6x sooner at the median, 2x at p95 (docs/COORDINATOR-PERFORMANCE-REVIEW.md).
  COMMONS_COORDINATOR_TEXT_DISABLED: z.enum(["true", "false"]).default("false"),
  COMMONS_COORDINATOR_INFERENCE_POLICY: z.enum(["best", "openai", "openai-luna-none"]).default("openai"),
  // Models for the "openai" policy (OpenAI models only; see coordinator-inference-policy.ts).
  COMMONS_OPENAI_POLICY_MODEL: z.string().min(1).max(100).default("openai/gpt-4.1-mini"),
  COMMONS_OPENAI_POLICY_MINI_MODEL: z.string().min(1).max(100).default("openai/gpt-4.1-mini"),
  COMMONS_OPENAI_POLICY_PLANNING_MODEL: z.string().min(1).max(100).default("openai/gpt-6.1-terra"),
  COMMONS_COORDINATOR_PLANNING_MODEL: z.string().min(1).max(100).default("openai/gpt-6.1-sol"),
  COMMONS_OPENAI_POLICY_ESCALATION_MODEL: z.string().min(1).max(100).default("openai/gpt-6-astra"),
  COMMONS_WORKSPACE_MINI_MODEL: z.string().min(1).max(100).default("openai/gpt-4.1-mini"),
  COMMONS_WORKSPACE_SPARK_MODEL: z.string().min(1).max(100).default("meta/muse-spark-1.3"),
  COMMONS_WORKSPACE_SPARK_PROVIDER_POLICY: z.enum(["private", "standard"]).default("standard"),
  TYPESAFE_API_KEY: z.string().trim().min(1).optional(),
  TYPESAFE_MODEL: z.string().min(1).max(100).default("jev-latest"),
  // Explicitly opt into providers that do not meet Commons' usual private routing.
  // The default preserves zero-retention and no-collection requirements.
  COMMONS_COORDINATOR_PROVIDER_POLICY: z.enum(["private", "standard"]).default("private"),
  COMMONS_WORKSPACE_EVENT_ALLOWLIST: z.string().optional(),
  COMMONS_COORDINATOR_ADVISORY_MODEL: z.string().min(1).max(100).default("openai/gpt-6-astra"),
  COMMONS_COORDINATOR_ONBOARDING_ENABLED: z.enum(["true", "false"]).default("false"),
  // Coordinator personalities (Becky, Joan, Miles): paused by default since September 30 so every reply stays on the fast model and the voice stays
  // Commons. "true" restores the picker, styles, and the advisory model for styled answers.
  COMMONS_COORDINATOR_PERSONALITIES_ENABLED: z.enum(["true", "false"]).default("false"),
  COMMONS_COORDINATOR_LIVE_ENABLED: z.enum(["true", "false"]).default("false"),
  // Group messages are paused by default (coordinator workspace release). Set "true" to restore the composer and the
  // POST /messages route; stored messages are never deleted, so the rollback needs no data change.
  COMMONS_GROUP_MESSAGES_ENABLED: z.enum(["true", "false"]).default("false"),
  // Guided recipe lifecycle entry points (docs/RECIPE-LIFECYCLE-OVERNIGHT-PLAN.md). Off by default; turning it off hides the
  // entry points and closes the routes without touching saved drafts, polls, decisions or outcomes.
  // On for every account unless set to "false"; "false" falls back to the pilot lists.
  COMMONS_RECIPES_ENABLED: z.enum(["true", "false"]).default("true"),
  // Scoped recipe pilot while the global flag is off: a provider-verified account email AND a trip id must both be listed (comma-separated).
  // Empty lists keep recipes closed. See recipe-access.ts.
  COMMONS_RECIPES_PILOT_EMAILS: z.string().optional(),
  COMMONS_RECIPES_PILOT_TRIP_IDS: z.string().optional(),
  COMMONS_COORDINATOR_LIVE_MODEL: z.string().min(1).max(100).default("gpt-live-1"),
  COMMONS_DURABLE_RESEARCH_ENABLED: z.enum(["true", "false"]).optional(),
  // Conversation durability (October 20 plan): default off. Admission of organizer turns for execution by the separate turn runner.
  COMMONS_DURABLE_COORDINATOR_TURNS_ENABLED: z.enum(["true", "false"]).optional(),
  // Emergency stop for durable execution: the runner reports open work as interrupted instead of running it. Admission falls back to the legacy path.
  COMMONS_DURABLE_COORDINATOR_TURNS_PROCESSING_STOPPED: z.enum(["true", "false"]).optional(),
  // Default off. The organizer-reviewed web question to one traveler and its answer surface.
  COMMONS_PARTICIPANT_QUESTIONS_ENABLED: z.enum(["true", "false"]).optional(),
  // Preserve existing search when unset. Set false for known-information workflows.
  // Global beta audience uses provider-verified identity and existing trip/organizer permissions.
  // Pin the isolated prepaid project key after billing isolation is verified; no shared-project fallback.
  COMMONS_RESEARCH_BETA_PREPAID_KEY_SHA256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  COMMONS_RESEARCH_BETA_ENABLED: z.enum(["true", "false"]).default("false"),
  // Coordinator is retired. "true" restores it until the code is removed.
  COMMONS_COORDINATOR_ENABLED: z.enum(["true", "false"]).optional(),
  COMMONS_COORDINATOR_RESEARCH_ENABLED: z.enum(["true", "false"]).default("true"),
  COMMONS_COORDINATOR_DYNAMIC_UI_ENABLED: z.enum(["true", "false"]).default("false"),
  COMMONS_COMPARE_STAYS_ENABLED: z.enum(["true", "false"]).default("false"),
  // Activity shortlist, focused rounds and reviewed Plan handoffs: verified owner only.
  COMMONS_ACTIVITY_DECISIONS_PILOT_ENABLED: z.enum(["true", "false"]).default("false"),
  COMMONS_ASSISTANT_UI_ENABLED: z.enum(["true", "false"]).default("false"),
  // Itinerary Markdown export and reviewed re-import (itinerary-portability.ts). Off by default; also needs COMMONS_ASSISTANT_UI_ENABLED.
  // Turning it off hides the entry points and closes the routes; saved itineraries and their history are unchanged.
  COMMONS_ITINERARY_PORTABILITY_ENABLED: z.enum(["true", "false"]).default("false"),
  COMMONS_ITINERARY_PORTABILITY_PILOT_ENABLED: z.enum(["true", "false"]).default("false"),
  // Continuous coordinator (steerable durable tasks, one main conversation, subthreads). Off by default; see coordinatorSteeringEnabled.
  COMMONS_CONFIRMATION_INTAKE_ENABLED: z.enum(["true", "false"]).optional(),
  COMMONS_TRIP_MAP_ENABLED: z.enum(["true", "false"]).optional(),
  // Where partner and DMO inquiries are routed. Unset: inquiries are saved and show as "not routed".
  COMMONS_PARTNER_INQUIRY_ROUTE_EMAIL: z.string().email().optional(),
  // Beta Rework (docs/BETA-REWORK.md BR-04/BR-05): traveler SMS and booking intake. One flag, off by default. Off means every messaging
  // route answers 404, nothing is queued or sent, and no existing behavior changes.
  // No provider is selected yet; Twilio is a candidate. Unset keeps the channel without a provider (webhooks answer 503, nothing sends).
  // "in_app" reaches no phone: messages appear in a test thread for the accounts listed in COMMONS_SMS_IN_APP_ACCOUNTS, and nobody else sees texting at all.
  COMMONS_SMS_PROVIDER: z.enum(["twilio", "in_app"]).optional(),
  COMMONS_SMS_IN_APP_ACCOUNTS: z.string().optional(),
  // Messages with Commons on the web: the same conversation as texting, in Commons, with no phone. Off by default; the accounts list, when set,
  // limits it to those sign-in emails.
  COMMONS_WEB_MESSAGES_ENABLED: z.enum(["true", "false"]).default("false"),
  COMMONS_WEB_MESSAGES_ACCOUNTS: z.string().optional(),
  // A real provider sends only when this is "allowlist" (recipients listed below) or "live". Default "disabled": the queue fills, nothing leaves.
  COMMONS_SMS_SEND_MODE: z.enum(["disabled", "allowlist", "live"]).default("disabled"),
  COMMONS_SMS_RECIPIENT_ALLOWLIST: z.string().optional(),
  // The public origin the provider calls, used to verify its signature behind a proxy.
  COMMONS_SMS_WEBHOOK_ORIGIN: optionalUrl,
  TWILIO_ACCOUNT_SID: z.string().trim().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().trim().min(1).optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().trim().min(1).optional(),
  COMMONS_COORDINATOR_GOALS_ENABLED: z.enum(["true", "false"]).default("true"),
  COMMONS_COORDINATOR_GOALS_PILOT_ENABLED: z.enum(["true", "false"]).default("false"),
  COMMONS_GROUP_INVITATIONS_ENABLED: z.enum(["true", "false"]).default("false"),
  COMMONS_GROUP_INVITATIONS_PILOT_ENABLED: z.enum(["true", "false"]).default("false"),
  COMMONS_TRIP_BRAIN_ENABLED: z.enum(["true", "false"]).default("false"),
  COMMONS_COORDINATOR_STEERING_ENABLED: z.enum(["true", "false"]).default("false"),
  // An operator's statement that a task runner is actually operating (a scheduler or loop calling /api/internal/research-tasks). Off by default.
  COMMONS_COORDINATOR_TASK_RUNNER: z.enum(["active", "none"]).default("none"),
  // Release-held deeper itinerary research only. Ordinary chat and durable tasks keep their existing providers.
  COMMONS_DEEP_RESEARCH_PROVIDER: z.enum(["tavily", "perplexity"]).default("tavily"),
  PERPLEXITY_API_KEY: z.string().trim().min(1).optional(),
  TAVILY_API_KEY: z.string().trim().min(1).optional(),
  COMMONS_TAVILY_ACCESS_MODE: z.enum(["api_key", "keyless"]).default("api_key"),
}).passthrough().superRefine((environment, context) => {
  const hosted = Boolean(environment.VERCEL || environment.VERCEL_ENV);
  const production = environment.VERCEL_ENV === "production";
  const supabaseValues = [
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ];
  if (supabaseValues.some(Boolean) && !supabaseValues.every(Boolean)) {
    context.addIssue({
      code: "custom",
      message: "Supabase Auth requires both its URL and publishable key.",
    });
  }
  if (hosted) {
    for (const key of [
      "DATABASE_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "COMMONS_INVITATION_TOKEN_KEY",
      "CRON_SECRET",
    ] as const) {
      if (!environment[key]) {
        context.addIssue({ code: "custom", message: `${key} is required on Vercel.`, path: [key] });
      }
    }
  }
  if (production && !environment.NEXT_PUBLIC_SITE_URL) {
    context.addIssue({
      code: "custom",
      message: "NEXT_PUBLIC_SITE_URL is required in production.",
      path: ["NEXT_PUBLIC_SITE_URL"],
    });
  }
  if ((hosted || production) && environment.COMMONS_PILOT_ACTOR_ID) {
    context.addIssue({
      code: "custom",
      message: "COMMONS_PILOT_ACTOR_ID is limited to explicit local development.",
      path: ["COMMONS_PILOT_ACTOR_ID"],
    });
  }
});

export type CommonsRuntimeEnvironment = z.infer<typeof RuntimeEnvironmentSchema>;

export function readCommonsRuntimeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): CommonsRuntimeEnvironment {
  const result = RuntimeEnvironmentSchema.safeParse(environment);
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => issue.message).join(" ");
  throw new Error(`Invalid Commons server configuration. ${details}`);
}

/**
 * Coordinator trip changes (stay, budget, dates, destination, plan updates) are prepared for review and applied only by an
 * organizer. They are on for every trip. This is one global rollback switch: set COMMONS_COORDINATOR_TRIP_CHANGES_ENABLED to
 * exactly "false" to turn them off; unset or any other value keeps them on. The identifier is accepted so call sites do not
 * change, but it no longer gates anything. Authorization, organizer, review, and apply boundaries are enforced elsewhere.
 */
export function coordinatorTripChangesEnabled(_identifier: string, environment: NodeJS.ProcessEnv = process.env) {
  return environment.COMMONS_COORDINATOR_TRIP_CHANGES_ENABLED?.trim() !== "false";
}

/**
 * Streamed coordinator replies. On unless COMMONS_COORDINATOR_STREAMING_ENABLED is exactly "false"; then POST /turns answers JSON even when a
 * stream is asked for, which the Workspace reads the same way. A rollback switch that needs no redeploy and changes no data.
 */
/** New durable admission only; accepted work is drained or interrupted by the runner regardless of this switch (A16). */
export function durableCoordinatorTurnsEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.COMMONS_DURABLE_COORDINATOR_TURNS_ENABLED?.trim() === "true" && environment.COMMONS_DURABLE_COORDINATOR_TURNS_PROCESSING_STOPPED?.trim() !== "true";
}
export function durableCoordinatorProcessingStopped(environment: NodeJS.ProcessEnv = process.env) {
  return environment.COMMONS_DURABLE_COORDINATOR_TURNS_PROCESSING_STOPPED?.trim() === "true";
}
/** COMMONS_BETA_REWORK_ENABLED (on unless "false"): beta-created trips get Trip · Plan · Money with direct goals and no Coordinator product (DESIGN.md "Coordination without a Coordinator"). With it off, capability resolution is identical to before. */
/** Whether the text channel can actually send: a provider is chosen and sending isn't disabled. Otherwise don't invite anyone to enroll. */
export function textMessagingAvailable(environment: { [name: string]: unknown } = process.env) {
  return betaReworkEnabled(environment) && Boolean(environment.COMMONS_SMS_PROVIDER) && environment.COMMONS_SMS_PROVIDER !== "in_app" && ["allowlist", "live"].includes(String(environment.COMMONS_SMS_SEND_MODE ?? ""));
}
/** The in-app test thread: no phone is involved, and it exists only for the sign-in emails listed. */
export function inAppThreadEnabledFor(email: string | null | undefined, environment: { [name: string]: unknown } = process.env) {
  if (!betaReworkEnabled(environment) || environment.COMMONS_SMS_PROVIDER !== "in_app" || !email) return false;
  const listed = String(environment.COMMONS_SMS_IN_APP_ACCOUNTS ?? "").split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
  return listed.includes(email.trim().toLowerCase());
}
/** Is web messaging on at all (for anyone)? */
export function webMessagesEnabled(environment: { [name: string]: unknown } = process.env) {
  return betaReworkEnabled(environment) && environment.COMMONS_WEB_MESSAGES_ENABLED === "true";
}
/** Is web messaging on for this signed-in email? With an accounts list set, only those emails. */
export function webMessagesEnabledFor(email: string | null | undefined, environment: { [name: string]: unknown } = process.env) {
  if (!webMessagesEnabled(environment)) return false;
  const listed = String(environment.COMMONS_WEB_MESSAGES_ACCOUNTS ?? "").split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
  return !listed.length || Boolean(email && listed.includes(email.trim().toLowerCase()));
}
/** Is there anything that could carry a message, for any account? Enrollment is what decides who gets one. */
export function messageDeliveryConfigured(environment: { [name: string]: unknown } = process.env) {
  return textMessagingAvailable(environment) || webMessagesEnabled(environment) || (betaReworkEnabled(environment) && environment.COMMONS_SMS_PROVIDER === "in_app");
}

export function betaReworkEnabled(environment: { [name: string]: unknown } = process.env) {
  return String(environment.COMMONS_BETA_REWORK_ENABLED ?? "").trim() !== "false";
}
export function participantQuestionsEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.COMMONS_PARTICIPANT_QUESTIONS_ENABLED?.trim() === "true";
}

export function coordinatorStreamingEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.COMMONS_COORDINATOR_STREAMING_ENABLED?.trim() !== "false";
}

/**
 * Coordinator personalities. Paused (off) unless COMMONS_COORDINATOR_PERSONALITIES_ENABLED is exactly "true": replies are from Commons on the policy's
 * conversation model, the picker and style settings are hidden, and past replies keep their original attribution.
 */
export function coordinatorPersonalitiesEnabled(environment: { [name: string]: unknown } = process.env) {
  return String(environment.COMMONS_COORDINATOR_PERSONALITIES_ENABLED ?? "").trim() === "true";
}

/**
 * Continuous, steerable coordinator: durable tasks that can be amended or cancelled while they run, one main conversation per trip, optional subthreads.
 * Off unless COMMONS_COORDINATOR_STEERING_ENABLED is exactly "true", and then merged behavior is unchanged. Turning it off stops new steering
 * operations (start, amend, subthread, main conversation); status, cancellation and the worker's fenced reconciliation keep working for work that was
 * already accepted, so a rollback never strands a task. A change needs a new deployment (environment variables are read at build/start).
 */
export function coordinatorSteeringEnabled(environment: { [name: string]: unknown } = process.env) {
  return String(environment.COMMONS_COORDINATOR_STEERING_ENABLED ?? "").trim() === "true";
}

/**
 * Whether a task started now will actually run: steering is on, background research is on and has its search provider, and an operator has declared
 * a runner. Without all of these Commons says so and offers normal conversation instead; it never promises work continues after someone leaves.
 */
export function coordinatorTasksAvailable(environment: { [name: string]: unknown } = process.env) {
  return coordinatorResearchEnabled(environment) && (coordinatorSteeringEnabled(environment) || coordinatorGoalsEnabled(environment)) && String(environment.COMMONS_DURABLE_RESEARCH_ENABLED ?? "").trim() === "true"
    && Boolean(String(environment.TAVILY_API_KEY ?? "").trim()) && String(environment.COMMONS_COORDINATOR_TASK_RUNNER ?? "").trim() === "active";
}

export function coordinatorResearchEnabled(environment: { [name: string]: unknown } = process.env) {
  return String(environment.COMMONS_COORDINATOR_RESEARCH_ENABLED ?? "true").trim() === "true";
}

/** Reversible feature control. Anything other than an explicit "true" keeps group messages hidden and their route closed. */
export function groupMessagesEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.COMMONS_GROUP_MESSAGES_ENABLED?.trim() === "true";
}

export function commonsDatabaseUrl(environment: NodeJS.ProcessEnv = process.env) {
  return readCommonsRuntimeEnvironment(environment).DATABASE_URL ?? null;
}

export function requireCommonsDatabaseUrl(environment: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = commonsDatabaseUrl(environment);
  if (!databaseUrl) throw new Error("Commons database persistence is not configured.");
  return databaseUrl;
}

export function commonsSiteOrigin(
  requestOrigin?: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configured = readCommonsRuntimeEnvironment(environment).NEXT_PUBLIC_SITE_URL;
  if (configured) return new URL(configured).origin;
  const vercelUrl = readCommonsRuntimeEnvironment(environment).VERCEL_URL;
  if (vercelUrl) return new URL(`https://${vercelUrl}`).origin;
  if (requestOrigin) return new URL(requestOrigin).origin;
  throw new Error("NEXT_PUBLIC_SITE_URL is required outside a request context.");
}

export function requireCronSecret(environment: NodeJS.ProcessEnv = process.env) {
  const secret = readCommonsRuntimeEnvironment(environment).CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not configured.");
  return secret;
}

export function authorizeCommonsCronRequest(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env,
):
  | { authorized: true; origin: string }
  | { authorized: false; status: 401 | 503; error: string } {
  let secret: string;
  try {
    secret = requireCronSecret(environment);
  } catch {
    return { authorized: false, status: 503, error: "CRON_SECRET is not configured." };
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return { authorized: false, status: 401, error: "Unauthorized." };
  }
  return {
    authorized: true,
    origin: commonsSiteOrigin(new URL(request.url).origin, environment),
  };
}



export function coordinatorGoalsEnabled(environment: { [name: string]: unknown } = process.env) {
  // Goals are on for every account unless explicitly turned off.
  return String(environment.COMMONS_COORDINATOR_GOALS_ENABLED ?? "true").trim() !== "false";
}

/** Presentation-only organizer pilot. No new research or action authority. */
export function compareStaysEnabled(environment: { [name: string]: unknown } = process.env) {
  return environment.COMMONS_COMPARE_STAYS_ENABLED === "true";
}

export function coordinatorDynamicUiEnabled(environment: { [name: string]: unknown } = process.env) { return environment.COMMONS_COORDINATOR_DYNAMIC_UI_ENABLED === "true"; }
