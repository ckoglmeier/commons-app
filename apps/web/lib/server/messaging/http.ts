import { CommandAccessError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "../commons-access-errors";
import { betaReworkEnabled } from "../runtime-environment";
import { MessagingUnavailableError } from "./core";

const headers = { "Cache-Control": "private, no-store" };
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
export const notFound = () => json({ error: { code: "not_found", message: "This isn't available." } }, 404);

/**
 * Every messaging route goes through here. With COMMONS_BETA_REWORK_ENABLED off the answer is a plain not-found before any configuration,
 * database or provider is touched, so the flag-off build behaves as if these routes did not exist. Errors carry stable, content-free codes.
 */
export async function messagingRoute(handler: () => Promise<Response>): Promise<Response> {
  if (!betaReworkEnabled()) return notFound();
  try { return await handler(); }
  catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return json({ error: { code: "auth_required", message: "Sign in to continue." } }, 401);
    if (error instanceof CommonsMembershipRequiredError || error instanceof CommandAccessError) return notFound();
    if (error instanceof MessagingUnavailableError) return json({ error: { code: "unavailable", message: "Texting isn't available right now." } }, 503);
    if (error instanceof ZodError) return json({ error: { code: "invalid", message: "Check the details and try again." } }, 400);
    console.warn("commons.messaging.route_error", { error: error instanceof Error ? error.name : "unknown" });
    return json({ error: { code: "failed", message: "That didn’t work. Try again." } }, 500);
  }
}
