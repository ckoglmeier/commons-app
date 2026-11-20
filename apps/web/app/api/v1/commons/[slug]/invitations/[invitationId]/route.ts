import { CommonsPeopleSchema, UpdateCommonsInvitationRequestSchema } from "@commons/contracts";
import { NextResponse } from "next/server";
import { errorTextForResponse } from "@/lib/server/error-response";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  revokeAuthenticatedCommonsInvitation,
  updateAuthenticatedCommonsInvitation,
} from "@/lib/server/commons";

function failure(error: unknown) {
  if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check the invitation details." }, { status: 400 });
  return NextResponse.json({ error: errorTextForResponse(error, "Invitation not updated.") }, { status: 409 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string; invitationId: string }> }) {
  try {
    const { slug, invitationId } = await params;
    const input = UpdateCommonsInvitationRequestSchema.parse(await request.json());
    return NextResponse.json({ people: CommonsPeopleSchema.parse(await updateAuthenticatedCommonsInvitation(slug, invitationId, input)) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ slug: string; invitationId: string }> }) {
  try {
    const { slug, invitationId } = await params;
    return NextResponse.json({ people: CommonsPeopleSchema.parse(await revokeAuthenticatedCommonsInvitation(slug, invitationId)) });
  } catch (error) {
    return failure(error);
  }
}
