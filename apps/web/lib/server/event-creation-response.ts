import { EventCreationRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
} from "./commons";

export function eventCreationErrorResponse(error: unknown) {
  if (error instanceof CommonsAuthenticationRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof CommonsMembershipRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof EventCreationRepositoryError) {
    const status = error.code === "draft_conflict" ? 409 : error.code === "draft_not_found" ? 404 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Check the event details." }, { status: 400 });
  }
  return NextResponse.json({ error: "Event setup is unavailable. Try again." }, { status: 503 });
}
