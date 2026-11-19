import { NextResponse } from "next/server";
import { CommandAccessError } from "@commons/database";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons-access-errors";
import { activationRefusal } from "@/lib/server/trip-activation";
import { declareTripGoing, tripStagesEnabled } from "@/lib/server/trip-stages";

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!tripStagesEnabled()) return new NextResponse(null, { status: 404 });
  try { return NextResponse.json(await declareTripGoing((await params).slug)); }
  catch (error) {
    const refused = activationRefusal(error);
    if (refused) return refused;
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "Only an organizer can do this." }, { status: 403 });
    return NextResponse.json({ error: "That didn’t save. Your trip is unchanged. Try again." }, { status: 503 });
  }
}
