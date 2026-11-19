import type { Instrumentation } from "next";
import { reportServerError } from "./lib/server-error-report";

/** Runs once per server instance before any request: settings from Marketplace names, and the invitation key kept in the database. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { applyEnvironmentAliases } = await import("@commons/database/environment-aliases");
  applyEnvironmentAliases();
  if (!process.env.COMMONS_INVITATION_TOKEN_KEY?.trim() && process.env.DATABASE_URL) {
    try {
      const { storedInvitationTokenKey } = await import("@commons/database");
      process.env.COMMONS_INVITATION_TOKEN_KEY = await storedInvitationTokenKey(process.env.DATABASE_URL);
    } catch {
      console.warn("commons.setup.invitation_key_unavailable", { hint: "Run the database migrations, or set COMMONS_INVITATION_TOKEN_KEY." });
    }
  }
}

/** Sanitized uncaught server errors to the runtime log and, in production, PostHog (lib/server-error-report.ts). */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  try { await reportServerError(error, request, context); } catch { /* Reporting never changes the response. */ }
};
