import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistItineraryItemDelete,
  persistItineraryItemUpdate,
} from "@/lib/server/commons";

function errorResponse(error: unknown, action: "updated" | "deleted") {
  if (error instanceof CommonsAuthenticationRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof CommonsMembershipRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: `Plan not ${action}. Check its details.` }, { status: 400 });
  }
  if (error instanceof CommonsRepositoryError) {
    const status = error.code === "itinerary_conflict" ? 409 : error.code === "commons_not_found" || error.code === "itinerary_not_found" ? 404 : 403;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ error: `Plan not ${action}. Try again.` }, { status: 503 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; itemId: string }> },
) {
  try {
    const { slug, itemId } = await params;
    const snapshot = await persistItineraryItemUpdate(slug, itemId, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    return errorResponse(error, "updated");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; itemId: string }> },
) {
  try {
    const { slug, itemId } = await params;
    const snapshot = await persistItineraryItemDelete(slug, itemId, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    return errorResponse(error, "deleted");
  }
}
