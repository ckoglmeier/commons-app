import { CommandAccessError, CommandConflictError } from "@commons/database";
import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { readBoundedJson } from "@/lib/bounded-json";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistMoneySettings,
} from "@/lib/server/commons";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const snapshot = await persistMoneySettings(slug, await readBoundedJson(request, 2000));
    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof CommandConflictError) return NextResponse.json({ error: "Money settings changed. Reload the trip before trying again." }, { status: 409 });
    if (error instanceof CommandAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Money settings not saved. Check the currency code." }, { status: 400 });
    }
    if (error instanceof CommonsRepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "commons_not_found" ? 404 : 403 });
    }
    return NextResponse.json({ error: "Couldn’t confirm the save. Reload to check the money settings." }, { status: 503 });
  }
}
