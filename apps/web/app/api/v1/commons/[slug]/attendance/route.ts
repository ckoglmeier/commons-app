import { AttendanceReviewError, CommandAccessError, CommandConflictError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons";
import { loadAuthenticatedEventAttendance, saveAuthenticatedEventAttendance } from "@/lib/server/polls";

function failure(error: unknown) {
  if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "This trip is not available to this account." }, { status: 403 });
  if (error instanceof AttendanceReviewError || error instanceof CommandConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof ZodError) return NextResponse.json({ error: "Review your attendance answer." }, { status: 400 });
  return NextResponse.json({ error: "Attendance not saved. Try again." }, { status: 503 });
}
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { return NextResponse.json(await loadAuthenticatedEventAttendance((await params).slug), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { return NextResponse.json(await saveAuthenticatedEventAttendance((await params).slug, await request.json())); }
  catch (error) { return failure(error); }
}
