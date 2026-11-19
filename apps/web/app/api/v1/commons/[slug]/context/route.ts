import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CommandAccessError, CommandConflictError, CoordinatorTurnError } from "@commons/database";
import { authenticatedTripPlanningContext } from "@/lib/server/polls";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons";
import { readBoundedJson } from "@/lib/bounded-json";
const headers = { "Cache-Control": "private, no-store" };
async function handle(request: Request, params: Promise<{ slug: string }>, write: boolean) {
  try {
    const { slug } = await params;
    return NextResponse.json(await authenticatedTripPlanningContext(slug, write ? await readBoundedJson(request, 32_000) : undefined), { headers });
  } catch (error) {
    const status = error instanceof CommonsAuthenticationRequiredError ? 401
      : error instanceof CommonsMembershipRequiredError || error instanceof CommandAccessError || error instanceof CoordinatorTurnError ? 403
      : error instanceof CommandConflictError ? 409 : error instanceof ZodError || error instanceof SyntaxError ? 400 : 503;
    return NextResponse.json({ error: status === 409 ? "Another organizer updated the trip context. Your edits are still here."
      : status === 401 ? "Sign in again to save your trip context."
      : status === 403 ? "Only active organizers can view or edit trip context."
      : status === 400 ? "Check the context fields and budget range. Nothing was saved."
      : "Couldn’t confirm the save. Try the same request again." }, { status, headers });
  }
}
export const GET = (request: Request, { params }: { params: Promise<{ slug: string }> }) => handle(request, params, false);
export const PATCH = (request: Request, { params }: { params: Promise<{ slug: string }> }) => handle(request, params, true);
