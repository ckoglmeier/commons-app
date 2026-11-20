import type { RenderedEmail } from "./invitation-email";
import { readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";

type SendMode = "disabled" | "log" | "live";

export class EmailDeliveryError extends Error {
  constructor(
    public readonly code:
      | "delivery_disabled"
      | "email_not_configured"
      | "provider_rejected"
      | "provider_rate_limited"
      | "provider_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

export type SendEmailInput = RenderedEmail & {
  to: string;
  idempotencyKey: string;
};

/** Explicit mode, else live when Resend is fully configured, else log in development, else disabled. "production" is the legacy name for live. */
function configuredMode(): SendMode {
  const environment = readCommonsRuntimeEnvironment();
  const mode = environment.COMMONS_EMAIL_SEND_MODE;
  if (mode === "production") return "live";
  if (mode) return mode;
  if (environment.RESEND_API_KEY && environment.COMMONS_EMAIL_FROM) return "live";
  return environment.NODE_ENV === "development" ? "log" : "disabled";
}

/** True when this copy can send email (Resend is set up, or emails are printed to the log in development). Without it, sign-in uses passwords. */
export function emailDeliveryAvailable() {
  return configuredMode() !== "disabled";
}

export function assertEmailDeliveryAllowed(_recipient?: string) {
  if (configuredMode() === "disabled") {
    throw new EmailDeliveryError("delivery_disabled", "Email delivery is disabled.");
  }
}

export async function sendEmail(input: SendEmailInput) {
  assertEmailDeliveryAllowed(input.to);
  if (configuredMode() === "log") {
    console.info("commons.email.logged", { to: input.to, subject: input.subject, text: input.text });
    return { id: `logged-${input.idempotencyKey}` };
  }
  const environment = readCommonsRuntimeEnvironment();
  const apiKey = environment.RESEND_API_KEY;
  const from = environment.COMMONS_EMAIL_FROM;
  if (!apiKey || !from) {
    throw new EmailDeliveryError("email_not_configured", "RESEND_API_KEY and COMMONS_EMAIL_FROM are required to send email.");
  }
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
  } catch {
    throw new EmailDeliveryError("provider_unavailable", "The email provider could not be reached.");
  }
  const result: unknown = await response.json().catch(() => null);
  const id = result && typeof result === "object" && "id" in result && typeof result.id === "string" ? result.id.trim() : "";
  if (!response.ok || !id) {
    throw new EmailDeliveryError(
      response.status === 429 ? "provider_rate_limited" : response.ok || response.status === 408 || response.status >= 500 ? "provider_unavailable" : "provider_rejected",
      "The email provider did not confirm acceptance. Check delivery status before retrying.",
    );
  }
  return { id };
}
