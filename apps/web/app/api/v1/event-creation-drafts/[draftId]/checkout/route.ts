import { NextResponse } from "next/server";
import { CommandAccessError, TripActivationError } from "@commons/database";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons-access-errors";
import { groupInvitationBody } from "@/lib/server/group-invitation-http";
import { activationRefusal, beginTripCheckout, betaActivationEnabled } from "@/lib/server/trip-activation";

export async function POST(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  if (!betaActivationEnabled()) return new NextResponse(null, { status: 404 });
  try {
    await groupInvitationBody(request); // Same-origin and JSON checks against configured origins, never a forwarded host.
    return NextResponse.json(await beginTripCheckout((await params).draftId, new URL(request.url).origin));
  } catch (error) {
    const refused = activationRefusal(error);
    if (refused) return refused;
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "Checkout is unavailable." }, { status: 403 });
    if (error instanceof TripActivationError && error.code === "approval_required") return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    if (error instanceof TripActivationError && error.code === "draft_not_found") return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: "Checkout isn’t available right now. Your trip is saved and nothing was charged." }, { status: 503 });
  }
}
