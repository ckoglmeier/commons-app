import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CommandAccessError, CommandConflictError, GroupInvitationUnavailableError, TripActivationRequiredError } from "@commons/database";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "./commons-access-errors";
export const groupInvitationHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
export function groupInvitationFailure(error: unknown) {
  if (error instanceof TripActivationRequiredError) return NextResponse.json({ error: error.message, code: error.code, state: error.state }, { status: 409, headers: groupInvitationHeaders });
  const status = error instanceof CommonsAuthenticationRequiredError ? 401 : error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError ? 403 : error instanceof ZodError ? 400 : error instanceof CommandConflictError || error instanceof GroupInvitationUnavailableError ? 409 : 500;
  const message = status === 500 ? "Couldn’t confirm this invitation change. Reload before trying again." : status === 400 ? "Check the invitation and try again." : error instanceof Error ? error.message : "Invitation unavailable.";
  return NextResponse.json({ error: message }, { status, headers: groupInvitationHeaders });
}
export async function groupInvitationBody(request: Request) {
  // Next may normalize a loopback/proxy request URL to its internal hostname.
  // Compare against the configured public origin, never a client-forwarded host.
  const origin = request.headers.get("origin");
  const allowed = new Set<string>();
  if (process.env.NEXT_PUBLIC_SITE_URL) allowed.add(new URL(process.env.NEXT_PUBLIC_SITE_URL).origin);
  // These are the two owned production aliases, not a *.commons.travel rule.
  if (allowed.has("https://www.commons.travel") || allowed.has("https://commons.travel")) {
    allowed.add("https://www.commons.travel"); allowed.add("https://commons.travel");
  }
  // Trust only this deployment's server-provided hostname. Never accept a
  // client-forwarded host, arbitrary preview domain or vercel.app wildcard.
  if (process.env.VERCEL && ["preview", "production"].includes(process.env.VERCEL_ENV ?? "") && process.env.VERCEL_URL) {
    const deployed = new URL(`https://${process.env.VERCEL_URL}`);
    if (deployed.hostname.endsWith(".vercel.app") && !deployed.username && !deployed.password && deployed.pathname === "/") allowed.add(deployed.origin);
  }
  if (!allowed.size && !process.env.VERCEL && !process.env.VERCEL_ENV) allowed.add(new URL(request.url).origin);
  if (origin && !allowed.has(origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new CommandAccessError();
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ZodError([]);
  const body = await request.text(); if (body.length > 2048) throw new ZodError([]);
  try { return JSON.parse(body); } catch { throw new ZodError([]); }
}
