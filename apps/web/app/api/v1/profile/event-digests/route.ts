import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { EventDigestAccessError } from "@commons/database";
import { getCurrentCommonsIdentity } from "@/lib/server/commons";
import { loadAuthenticatedEventDigestPreferences, updateAuthenticatedEventDigestPreference } from "@/lib/server/profile";

export async function GET() {
  if (!await getCurrentCommonsIdentity()) return NextResponse.json({ error: "Sign in to see your email settings." }, { status: 401 });
  try {
    return NextResponse.json(await loadAuthenticatedEventDigestPreferences(), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn’t load your email settings. Try again." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!await getCurrentCommonsIdentity()) return NextResponse.json({ error: "Sign in to change your email settings." }, { status: 401 });
  try {
    return NextResponse.json(await updateAuthenticatedEventDigestPreference(await request.json()));
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Couldn’t save that choice. Refresh and try again." }, { status: 400 });
    if (error instanceof EventDigestAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: "Couldn’t save that choice. Try again." }, { status: 503 });
  }
}
