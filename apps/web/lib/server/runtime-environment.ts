import { applyEnvironmentAliases } from "@commons/database/environment-aliases";
import { z } from "zod";

const optionalUrl = z.string().url().optional();

const RuntimeEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  VERCEL: z.string().optional(),
  VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
  VERCEL_URL: z.string().min(1).optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().min(1).optional(),
  DATABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  COMMONS_INVITATION_TOKEN_KEY: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  NEXT_PUBLIC_SITE_URL: optionalUrl,
  COMMONS_PILOT_ACTOR_ID: z.string().uuid().optional(),
  // "false" turns poll framing help off everywhere; manual polls are unaffected.
  COMMONS_POLL_ASSISTANCE_ENABLED: z.string().optional(),
  // Booking-confirmation intake (confirmation-intake.ts). Unset keeps it hidden, as before.
  COMMONS_CONFIRMATION_INTAKE_ENABLED: z.enum(["true", "false"]).optional(),
  // Email: "live" sends through Resend, "log" prints the message to the server console, "disabled" sends nothing. "production" is the legacy name for "live".
  // Unset: live when RESEND_API_KEY and COMMONS_EMAIL_FROM are set, else log in development, else disabled.
  COMMONS_EMAIL_SEND_MODE: z.enum(["disabled", "log", "live", "production"]).optional(),
  COMMONS_EMAIL_FROM: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  // No default: unset keeps poll help off. "auto" selects Terra low for initial framing / Luna none for revisions; a model ID pins both.
  COMMONS_POLL_MODEL: z.string().min(1).max(100).optional(),
  // Texting is configured when all three Twilio settings are set. "live" (the default then) sends; "log" records messages as sent in the server log only.
  COMMONS_SMS_SEND_MODE: z.enum(["live", "log"]).optional(),
  // The public origin the provider calls, used to verify its signature behind a proxy.
  COMMONS_SMS_WEBHOOK_ORIGIN: optionalUrl,
  TWILIO_ACCOUNT_SID: z.string().trim().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().trim().min(1).optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().trim().min(1).optional(),
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
      "CRON_SECRET",
    ] as const) {
      if (!environment[key]) {
        context.addIssue({ code: "custom", message: `${key} is required on Vercel.`, path: [key] });
      }
    }
  }
  // On Vercel the production address stands in (commonsSiteOrigin); a custom domain should set NEXT_PUBLIC_SITE_URL.
  if (production && !environment.NEXT_PUBLIC_SITE_URL && !environment.VERCEL_PROJECT_PRODUCTION_URL) {
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
  // Marketplace integration names (POSTGRES_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ...) fill Commons's names when those are empty.
  if (environment === process.env) applyEnvironmentAliases(process.env as Record<string, string | undefined>);
  const result = RuntimeEnvironmentSchema.safeParse(environment);
  // With an OpenAI key and no model chosen, writing help uses the "auto" model choice.
  if (result.success) return { ...result.data, COMMONS_POLL_MODEL: result.data.COMMONS_POLL_MODEL ?? (result.data.OPENAI_API_KEY ? "auto" : undefined) };
  const details = result.error.issues.map((issue) => issue.message).join(" ");
  throw new Error(`Invalid Commons server configuration. ${details}`);
}

/** Whether the text channel can send: Twilio is fully configured. Otherwise nobody is invited to enroll a phone. */
export function textMessagingAvailable(environment: { [name: string]: unknown } = process.env) {
  return ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_MESSAGING_SERVICE_SID"].every(name => String(environment[name] ?? "").trim() !== "");
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
  const runtime = readCommonsRuntimeEnvironment(environment);
  if (runtime.VERCEL_ENV === "production" && runtime.VERCEL_PROJECT_PRODUCTION_URL) return new URL(`https://${runtime.VERCEL_PROJECT_PRODUCTION_URL}`).origin;
  const vercelUrl = runtime.VERCEL_URL;
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
