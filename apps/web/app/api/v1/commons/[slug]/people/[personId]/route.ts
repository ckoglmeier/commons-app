import { NextResponse } from "next/server";
import { CommonsPeopleSchema, UpdateCommonsPersonRoleRequestSchema } from "@commons/contracts";
import { ZodError } from "zod";
import {
  blockAuthenticatedCommonsMemberRemoval,
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  updateAuthenticatedCommonsMemberRole,
} from "@/lib/server/commons";

function failure(error: unknown) {
  if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Choose an organizer role." }, { status: 400 });
  return NextResponse.json({ error: error instanceof Error ? error.message : "Organizer access not changed." }, { status: 409 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string; personId: string }> }) {
  try {
    const { slug, personId } = await params;
    const input = UpdateCommonsPersonRoleRequestSchema.parse(await request.json());
    return NextResponse.json({ people: CommonsPeopleSchema.parse(await updateAuthenticatedCommonsMemberRole(slug, personId, input)) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ slug: string; personId: string }> }) {
  try {
    const { slug, personId } = await params;
    await blockAuthenticatedCommonsMemberRemoval(slug, personId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
