import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { listTripTasks, saveTripTask, CommandAccessError, CommandConflictError } from "@commons/database";
import { authenticatedConfirmationIntakeOptions, CommonsAuthenticationRequiredError } from "@/lib/server/commons";
function failure(error: unknown) {
  const status = error instanceof CommonsAuthenticationRequiredError ? 401 : error instanceof CommandAccessError ? 403 : error instanceof CommandConflictError ? 409 : error instanceof ZodError ? 400 : 503;
  return NextResponse.json({ error: status === 409 ? "This task changed. Reopen it before saving." : status === 403 ? "You cannot change this task or its linked item." : status === 400 ? "Check the task title, owner and linked item." : "Tasks could not be loaded or saved. Try again." }, { status });
}
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { return NextResponse.json({ tasks: await listTripTasks((await params).slug, await authenticatedConfirmationIntakeOptions()) }); } catch (error) { return failure(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { return NextResponse.json({ task: await saveTripTask((await params).slug, await request.json(), await authenticatedConfirmationIntakeOptions()) }); } catch (error) { return failure(error); }
}
