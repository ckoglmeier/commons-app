import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { InstanceAdminRequiredError } from "@commons/database";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons";
import { saveJoinSettings } from "@/lib/server/instance-access";

export const dynamic = "force-dynamic";

/** The instance admin changes who may create an account. Anyone else gets a not-found. */
export async function PUT(request: Request) {
  try {
    const saved = await saveJoinSettings(await request.json().catch(() => null));
    return NextResponse.json({ signupMode: saved.signupMode, allowedDomains: saved.allowedDomains }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    if (error instanceof InstanceAdminRequiredError || error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message === "Add at least one email domain." ? "Add at least one email domain." : "Choose who can join." }, { status: 400 });
    throw error;
  }
}
