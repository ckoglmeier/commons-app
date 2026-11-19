import { NextResponse } from "next/server";
import { CommandAccessError } from "@commons/database";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons-access-errors";
import { declareTripGoing } from "@/lib/server/trip-stages";

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { return NextResponse.json(await declareTripGoing((await params).slug)); }
  catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "Only an organizer can do this." }, { status: 403 });
    return NextResponse.json({ error: "That didn’t save. Your trip is unchanged. Try again." }, { status: 503 });
  }
}
