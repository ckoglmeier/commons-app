import { CommonsSetupSchema } from "@commons/contracts";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  loadAuthenticatedCommonsSetup,
  saveAuthenticatedCommonsTravelers,
} from "@/lib/server/commons";

function errorResponse(error: unknown) {
  if (error instanceof CommonsAuthenticationRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof CommonsMembershipRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message ?? "Check the traveler details." },
      { status: 400 },
    );
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Setup not saved. Try again." },
    { status: 503 },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    return NextResponse.json({ setup: CommonsSetupSchema.parse(await loadAuthenticatedCommonsSetup(slug)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const setup = await saveAuthenticatedCommonsTravelers(slug, await request.json());
    return NextResponse.json({ setup: CommonsSetupSchema.parse(setup) });
  } catch (error) {
    return errorResponse(error);
  }
}
