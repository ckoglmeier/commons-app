import { ZodError } from "zod";
import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistTravelPlan,
  persistFlightBooking,
  persistTravelPlanDelete,
  persistTravelPlanSharing,
} from "@/lib/server/commons";
import { recordOutcome, recordOperationFailure } from "@/lib/server/outcome-telemetry";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const input = await request.json();
    const snapshot = await persistTravelPlan(slug, input);
    recordOutcome({ event: "plan_item_saved", key: String((input as { commandId?: unknown })?.commandId ?? ""), trip: slug, request, properties: { kind: "travel" } });
    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Travel plan not saved. Check each field and try again." },
        { status: 400 },
      );
    }
    if (error instanceof CommonsRepositoryError) {
      const status = error.code === "commons_not_found"
        ? 404
        : error.code === "travel_plan_conflict"
          ? 409
          : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    recordOperationFailure({ operation: "plan_item_save", error, trip: (await params).slug, request });
    return NextResponse.json(
      { error: "Travel plan not saved. Try again." },
      { status: 503 },
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const snapshot = await persistFlightBooking(slug, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof ZodError) return NextResponse.json({ error: "Flight booking not saved. Check each flight and try again." }, { status: 400 });
    if (error instanceof CommonsRepositoryError) {
      const status = error.code === "commons_not_found" ? 404 : error.code === "travel_plan_conflict" ? 409 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "Flight booking not saved. Try again." }, { status: 503 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const snapshot = await persistTravelPlanSharing(slug, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Travel plan sharing not changed. Try again." }, { status: 400 });
    }
    if (error instanceof CommonsRepositoryError) {
      const status = error.code === "commons_not_found" || error.code === "travel_plan_not_found" ? 404 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "Travel plan sharing not changed. Try again." }, { status: 503 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const snapshot = await persistTravelPlanDelete(slug, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Travel plan not removed. Try again." }, { status: 400 });
    }
    if (error instanceof CommonsRepositoryError) {
      const status = error.code === "commons_not_found" || error.code === "travel_plan_not_found" ? 404 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "Travel plan not removed. Try again." }, { status: 503 });
  }
}
