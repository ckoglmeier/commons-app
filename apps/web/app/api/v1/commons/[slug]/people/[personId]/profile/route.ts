import { TravelerProfileAccessError } from "@commons/database";
import { NextResponse } from "next/server";
import { errorTextForResponse } from "@/lib/server/error-response";
import { ZodError } from "zod";
import {
  loadAuthenticatedManagedTravelerProfile,
  updateAuthenticatedManagedTravelerProfile,
} from "@/lib/server/profile";

function failure(error: unknown) {
  if (error instanceof TravelerProfileAccessError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Check the travel details and try again." }, { status: 400 });
  }
  return NextResponse.json({ error: errorTextForResponse(error, "Travel profile unavailable.") }, { status: 503 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; personId: string }> }) {
  try {
    const { slug, personId } = await params;
    return NextResponse.json(await loadAuthenticatedManagedTravelerProfile(slug, personId));
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string; personId: string }> }) {
  try {
    const { slug, personId } = await params;
    return NextResponse.json(await updateAuthenticatedManagedTravelerProfile(slug, personId, await request.json()));
  } catch (error) {
    return failure(error);
  }
}
