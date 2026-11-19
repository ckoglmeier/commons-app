import { betaReworkEnabled } from "@/lib/beta/flags";
import { NextResponse } from "next/server";
import { CommandAccessError, TripActivationError } from "@commons/database";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons-access-errors";
import { groupInvitationBody } from "@/lib/server/group-invitation-http";
import { activationRefusal, inviteSavedPeopleFromDraft } from "@/lib/server/trip-activation";

export async function POST(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  if (!betaReworkEnabled()) return new NextResponse(null, { status: 404 });
  try {
    const input = await groupInvitationBody(request);
    return NextResponse.json({ result: await inviteSavedPeopleFromDraft((await params).draftId, input, new URL(request.url).origin) });
  } catch (error) {
    const refused = activationRefusal(error);
    if (refused) return refused;
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "Only the trip’s organizer can do this." }, { status: 403 });
    if (error instanceof TripActivationError) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: "Invitations weren’t sent. Your trip is saved. Try again." }, { status: 503 });
  }
}
