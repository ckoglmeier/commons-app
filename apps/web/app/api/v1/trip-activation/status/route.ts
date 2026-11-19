import { betaReworkEnabled } from "@/lib/beta/flags";
import { NextResponse } from "next/server";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons-access-errors";
import { loadTripActivationStatus } from "@/lib/server/trip-activation";

/** Owner-only. Anyone else, and any unknown id, gets the same 404. */
export async function GET(request: Request) {
  if (!betaReworkEnabled()) return new NextResponse(null, { status: 404 });
  const url = new URL(request.url), draftId = url.searchParams.get("draft"), trip = url.searchParams.get("trip");
  try {
    const status = draftId ? await loadTripActivationStatus({ draftId }) : trip ? await loadTripActivationStatus({ trip }) : null;
    if (!status) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ status }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: "Status unavailable. Your trip is saved." }, { status: 503 });
  }
}
