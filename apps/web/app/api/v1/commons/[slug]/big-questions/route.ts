import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CommandAccessError } from "@commons/database";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons-access-errors";
import { decideTripQuestion, linkBigQuestionPoll, loadBigQuestions, saveBrief } from "@/lib/server/trip-stages";

const headers = { "Cache-Control": "private, no-store" };

function failure(error: unknown) {
  if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers });
  if (error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "Only an organizer can do this." }, { status: 403, headers });
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check what you entered." }, { status: 400, headers });
  return NextResponse.json({ error: "That didn’t save. Your trip is unchanged. Try again." }, { status: 503, headers });
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { return NextResponse.json(await loadBigQuestions((await params).slug), { headers }); } catch (error) { return failure(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { await linkBigQuestionPoll((await params).slug, await request.json()); return NextResponse.json({ ok: true }, { headers }); } catch (error) { return failure(error); }
}

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { await decideTripQuestion((await params).slug, await request.json()); return NextResponse.json({ ok: true }, { headers }); } catch (error) { return failure(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { await saveBrief((await params).slug, await request.json()); return NextResponse.json({ ok: true }, { headers }); } catch (error) { return failure(error); }
}
