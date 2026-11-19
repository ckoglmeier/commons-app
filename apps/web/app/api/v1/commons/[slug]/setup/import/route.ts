import { CommonsSetupSchema } from "@commons/contracts";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  importAuthenticatedCommonsPlans,
} from "@/lib/server/commons";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const setup = await importAuthenticatedCommonsPlans(slug, await request.json());
    return NextResponse.json({ setup: CommonsSetupSchema.parse(setup) });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Check the plans." }, { status: 400 });
    }
    return NextResponse.json({ error: "Plans not added. Your review is still here. Try again." }, { status: 503 });
  }
}
