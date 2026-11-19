import { activationRefusal } from "@/lib/server/trip-activation";
import { NextResponse } from "next/server";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  sendAuthenticatedCommonsInvitations,
} from "@/lib/server/commons";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const origin = new URL(request.url).origin;
    const result = await sendAuthenticatedCommonsInvitations(slug, origin);
    return NextResponse.json({ result });
  } catch (error) {
    const refused = activationRefusal(error);
    if (refused) return refused;
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Invitations not sent. The trip is still private." }, { status: 503 });
  }
}
