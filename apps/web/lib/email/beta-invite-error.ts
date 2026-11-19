import { EmailDeliveryError } from "./resend";

export function betaInviteErrorMessage(error: unknown): string {
  if (error instanceof EmailDeliveryError) {
    const messages: Record<EmailDeliveryError["code"], string> = {
      delivery_disabled: "Email delivery is disabled in this environment.",
      recipient_not_allowed: "This email address is not on the email test allowlist.",
      email_not_configured: "Email delivery is missing its API key or sender address.",
      provider_rejected: "Resend rejected the invitation. Check the sender domain and Resend logs before retrying.",
      provider_rate_limited: "Resend is limiting email sending. Wait and retry. If it keeps happening, check the sending quota in Resend. Saved access is kept.",
      provider_unavailable: "Resend could not confirm delivery. Check the Resend logs before retrying. Saved access is kept.",
    };
    return messages[error.code];
  }
  if (error instanceof Error && ["Enter a valid email address.", "Keep the message to 2,000 characters.", "Email delivery is not configured."].includes(error.message)) return error.message;
  if (error instanceof Error && error.name === "CommonsOperatorRequiredError") return "Your admin session is unavailable. Sign in with your operator account and try again.";
  // Avoid logging raw database errors, which can contain email addresses or SQL parameters.
  const cause = error instanceof Error ? error.cause : undefined;
  const code = cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string" && /^[A-Z0-9]{5}$/.test(cause.code) ? cause.code : "unknown";
  console.error("beta_invitation_failed", { code });
  return "Couldn’t confirm the invitation. Saved access is kept. Try again. If it fails again, check the beta_invitation_failed entry in server logs.";
}
