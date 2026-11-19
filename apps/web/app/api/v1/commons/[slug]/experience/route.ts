import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CommandAccessError } from "@commons/database";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons-access-errors";
import { changeTripExperience, tripStagesEnabled } from "@/lib/server/trip-stages";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!tripStagesEnabled()) return new NextResponse(null, { status: 404 });
  try { return NextResponse.json(await changeTripExperience((await params).slug, await request.json())); }
  catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "Only an organizer can change this." }, { status: 403 });
    if (error instanceof ZodError) return NextResponse.json({ error: "Check the details and try again." }, { status: 400 });
    return NextResponse.json({ error: "That didn’t save. Your trip is unchanged." }, { status: 503 });
  }
}
