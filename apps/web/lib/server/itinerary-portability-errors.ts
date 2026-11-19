import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { SourceReadError } from "@/lib/import/coordinator-source";
import { legacyCoordinatorErrorResponse } from "./coordinator-errors";
import { ItineraryPortabilityError } from "./itinerary-portability";

const headers = { "Cache-Control": "private, no-store" };
/** Specific, non-leaking failures; every one says nothing was changed or why. */
export function itineraryImportFailure(error: unknown) {
  if (error instanceof ItineraryPortabilityError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof SourceReadError) return NextResponse.json({ error: error.message }, { status: 400, headers });
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message === "Paste or choose an itinerary file." ? error.issues[0].message : "Check the itinerary text and try again. Nothing was changed." }, { status: 400, headers });
  return legacyCoordinatorErrorResponse(error);
}
