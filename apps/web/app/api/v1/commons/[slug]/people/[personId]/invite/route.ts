import { CommonsPeopleSchema, UpdateCommonsInvitationRequestSchema } from "@commons/contracts";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { inviteAuthenticatedManagedTraveler, CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons";

export async function POST(request: Request, {params}: {params: Promise<{slug: string; personId: string}>}) {
  try {
    const {slug, personId} = await params;
    const input = UpdateCommonsInvitationRequestSchema.parse(await request.json());
    return NextResponse.json({people: CommonsPeopleSchema.parse(await inviteAuthenticatedManagedTraveler(slug, personId, input, new URL(request.url).origin))}, {status: 201});
  } catch (error) {
    const status = error instanceof CommonsAuthenticationRequiredError ? 401 : error instanceof CommonsMembershipRequiredError ? 403 : error instanceof ZodError ? 400 : 409;
    return NextResponse.json({error: error instanceof Error ? error.message : "Invitation not prepared. Try again."}, {status});
  }
}
