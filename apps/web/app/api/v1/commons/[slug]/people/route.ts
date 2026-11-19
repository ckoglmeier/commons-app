import { AddCommonsPersonRequestSchema, CommonsPeopleSchema } from "@commons/contracts";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  addAuthenticatedCommonsPerson,
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  loadAuthenticatedCommonsPeople,
} from "@/lib/server/commons";

function failure(error: unknown) {
  if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check the traveler details." }, { status: 400 });
  return NextResponse.json({ error: error instanceof Error ? error.message : "People could not be loaded." }, { status: 409 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    return NextResponse.json({ people: CommonsPeopleSchema.parse(await loadAuthenticatedCommonsPeople(slug)) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const input = AddCommonsPersonRequestSchema.parse(await request.json());
    return NextResponse.json({ people: CommonsPeopleSchema.parse(await addAuthenticatedCommonsPerson(slug, input, new URL(request.url).origin)) }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
