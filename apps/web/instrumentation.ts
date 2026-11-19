import type { Instrumentation } from "next";
import { reportServerError } from "./lib/server-error-report";

/** Sanitized uncaught server errors to the runtime log and, in production, PostHog (lib/server-error-report.ts). */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  try { await reportServerError(error, request, context); } catch { /* Reporting never changes the response. */ }
};
