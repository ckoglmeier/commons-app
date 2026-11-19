import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistPlacePin,
} from "@/lib/server/commons";

/** Saves or removes one stay's or activity's map pin. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const snapshot = await persistPlacePin(slug, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof ZodError) return NextResponse.json({ error: "Location not saved. Choose a point on the map." }, { status: 400 });
    if (error instanceof CommonsRepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "commons_not_found" ? 404 : 403 });
    }
    return NextResponse.json({ error: "Location not saved. Try again." }, { status: 503 });
  }
}
