import { ZodError } from "zod";
import { NextResponse } from "next/server";
import { EventCreationAccessRequiredError } from "@/lib/server/event-creation";
import {
  CommonsAuthenticationRequiredError,
  createAuthenticatedCommonsDraft,
  TripCreationMovedError,
} from "@/lib/server/commons";

export async function POST(request: Request) {
  try {
    const result = await createAuthenticatedCommonsDraft(await request.json());
    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    if (error instanceof TripCreationMovedError) return NextResponse.json({ error: error.message, next: error.next }, { status: 409 });
    if (error instanceof EventCreationAccessRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Check the trip details." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Trip not created. Try again." },
      { status: 503 },
    );
  }
}
