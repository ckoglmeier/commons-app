import { NextResponse } from "next/server";
import { errorTextForResponse } from "@/lib/server/error-response";
import { ZodError } from "zod";
import { loadAuthenticatedTravelerProfile, updateAuthenticatedTravelerProfile } from "@/lib/server/profile";

export async function GET() {
  try {
    return NextResponse.json(await loadAuthenticatedTravelerProfile());
  } catch (error) {
    return NextResponse.json({ error: errorTextForResponse(error, "Profile unavailable.") }, { status: 401 });
  }
}

export async function PATCH(request: Request) {
  try {
    return NextResponse.json(await updateAuthenticatedTravelerProfile(await request.json()));
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "Check the profile details and try again." }, { status: 400 });
    return NextResponse.json({ error: errorTextForResponse(error, "Profile not saved.") }, { status: 503 });
  }
}
