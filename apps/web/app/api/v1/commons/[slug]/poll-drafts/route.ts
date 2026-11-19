import { CommandAccessError, CommandConflictError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons";
import { loadAuthenticatedPollDrafts, saveAuthenticatedPollDraft } from "@/lib/server/polls";

function failure(error: unknown) {
  if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "This draft is not available to this account in this event." }, { status: 403 });
  if (error instanceof CommandConflictError) return NextResponse.json({ error: "The saved draft changed in another tab or was already shared. Your current edits are still here; reload the saved draft before continuing." }, { status: 409 });
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check the draft." }, { status: 400 });
  return NextResponse.json({ error: "Draft not saved. Your edits are still here. Try again." }, { status: 503 });
}
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { return NextResponse.json({ drafts: await loadAuthenticatedPollDrafts((await params).slug) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { const slug = (await params).slug, draft = await saveAuthenticatedPollDraft(slug, await request.json()); const [currentDraft] = await loadAuthenticatedPollDrafts(slug, draft.id); return NextResponse.json({ draft, currentDraft }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return failure(error); }
}
