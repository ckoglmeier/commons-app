import { InvitationLinkSchema } from "@commons/contracts";
import { NextResponse } from "next/server";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  copyAuthenticatedCommonsInvitationLink,
  rotateAuthenticatedCommonsInvitationLink,
} from "@/lib/server/commons";

function failure(error: unknown) {
  if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ error: error instanceof Error ? error.message : "Private link unavailable." }, { status: 409 });
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; invitationId: string }> }) {
  try {
    const { slug, invitationId } = await params;
    const origin = new URL(request.url).origin;
    return NextResponse.json({ link: InvitationLinkSchema.parse(await copyAuthenticatedCommonsInvitationLink(slug, invitationId, origin)) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; invitationId: string }> }) {
  try {
    const { slug, invitationId } = await params;
    const origin = new URL(request.url).origin;
    return NextResponse.json({ link: InvitationLinkSchema.parse(await rotateAuthenticatedCommonsInvitationLink(slug, invitationId, origin)) });
  } catch (error) {
    return failure(error);
  }
}
