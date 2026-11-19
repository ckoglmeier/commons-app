import type { RenderedEmail } from "./invitation-email";
import { readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";

type SendMode = "disabled" | "allowlist" | "production";

export class EmailDeliveryError extends Error {
  constructor(
    public readonly code:
      | "delivery_disabled"
      | "recipient_not_allowed"
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

function configuredMode(): SendMode {
  const mode = readCommonsRuntimeEnvironment().COMMONS_EMAIL_SEND_MODE ?? "disabled";
  if (mode === "disabled" || mode === "allowlist" || mode === "production") {
    return mode;
  }
  throw new Error(`Unknown COMMONS_EMAIL_SEND_MODE: ${mode}`);
}

function allowlistedRecipients() {
  const environment = readCommonsRuntimeEnvironment();
  return new Set(
    (environment.COMMONS_EMAIL_RECIPIENT_ALLOWLIST ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function assertEmailDeliveryAllowed(recipient: string) {
  const mode = configuredMode();
  if (mode === "disabled") {
    throw new EmailDeliveryError("delivery_disabled", "Email delivery is disabled.");
  }
  if (
    mode === "allowlist" &&
    !allowlistedRecipients().has(recipient.trim().toLowerCase())
  ) {
    throw new EmailDeliveryError("recipient_not_allowed", `${recipient} is not in the email test allowlist.`);
  }
}

export async function sendEmail(input: SendEmailInput) {
  assertEmailDeliveryAllowed(input.to);
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
