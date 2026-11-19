import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CommandAccessError, CommandConflictError, readTripBudget, saveTripBudget } from "@commons/database";
import { readBoundedJson } from "@/lib/bounded-json";
import { authenticatedCommonsRepositoryOptions } from "@/lib/server/commons";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons-access-errors";

const headers = { "Cache-Control": "private, no-store" };
async function options() {
  const resolved = await authenticatedCommonsRepositoryOptions();
  if (!resolved) throw new Error("Persistence unavailable.");
  return resolved;
}
function failure(error: unknown) {
  if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: "Sign in again to open the trip budget." }, { status: 401, headers });
  if (error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "You don’t have access to change this budget." }, { status: 403, headers });
  if (error instanceof CommandConflictError) return NextResponse.json({ error: "Another organizer saved a newer budget. Your edits are still here. Load the latest budget before editing again." }, { status: 409, headers });
  if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Check the budget entries and try again." }, { status: 400, headers });
  return NextResponse.json({ error: "Couldn’t confirm the budget save. Your edits are still here. Try again." }, { status: 503, headers });
}
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { return NextResponse.json(await readTripBudget((await params).slug, await options()), { headers }); }
  catch (error) { return failure(error); }
}
export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (request.headers.get("sec-fetch-site") === "cross-site" || (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin)) return NextResponse.json({ error: "Open this budget from your trip." }, { status: 403, headers });
  try {
    const resolved = await options();
    return NextResponse.json(await saveTripBudget((await params).slug, await readBoundedJson(request, 16_384), resolved), { headers });
  } catch (error) { return failure(error); }
}
