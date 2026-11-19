import { InvitationDeliveryActionSchema } from "@commons/contracts";
import { NextResponse } from "next/server";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  sendAuthenticatedCommonsInvitation,
} from "@/lib/server/commons";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; invitationId: string }> }) {
  try {
    const { slug, invitationId } = await params;
    const origin = new URL(request.url).origin;
    const delivery = await sendAuthenticatedCommonsInvitation(slug, invitationId, origin);
    return NextResponse.json({ delivery: InvitationDeliveryActionSchema.parse(delivery) });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invitation email could not be queued." }, { status: 409 });
  }
}
