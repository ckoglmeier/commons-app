import { NextResponse } from "next/server";
import { TripActivationError } from "@commons/database";
import { betaActivationEnabled, handleProviderWebhook } from "@/lib/server/trip-activation";
import { ProviderEvidenceError } from "@/lib/trip-activation/provider";

export async function POST(request: Request) {
  if (!betaActivationEnabled()) return new NextResponse(null, { status: 404 });
  try {
    await handleProviderWebhook(await request.text(), request.headers.get("stripe-signature") ?? "");
    return NextResponse.json({ received: true });
  } catch (error) {
    // A refund can arrive before its payment. Non-2xx asks the provider to redeliver; nothing is dropped or guessed.
    if (error instanceof TripActivationError && error.code === "evidence_pending") return NextResponse.json({ error: "Not ready for this event yet." }, { status: 409 });
    if (error instanceof ProviderEvidenceError || error instanceof TripActivationError) return NextResponse.json({ error: "Payment evidence rejected." }, { status: 400 });
    return NextResponse.json({ error: "Could not record this event." }, { status: 503 });
  }
}
