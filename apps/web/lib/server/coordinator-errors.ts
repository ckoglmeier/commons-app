import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { coordinatorError, coordinatorErrorCatalog, type CoordinatorError, type CoordinatorErrorCode } from "@commons/contracts";
import { CommandAccessError, CommandConflictError, CoordinatorAccessError, CoordinatorConflictError, CoordinatorTurnError, PollInferenceLimitError, TaskLimitError, TripCoordinationError } from "@commons/database";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "./commons-access-errors";

/** A model, research, or transport failure that happened after the request was saved. */
export class CoordinatorProviderError extends Error {
  constructor(readonly code: "provider_failed" | "provider_not_configured" | "research_limited" = "provider_failed") { super(`Coordinator provider: ${code}`); this.name = "CoordinatorProviderError"; }
}

const headers = { "Cache-Control": "private, no-store" };

/** Postgres unique_violation (23505), directly or wrapped by the query layer. */
function isUniqueViolation(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 3) return false;
  return (error as { code?: unknown }).code === "23505" || isUniqueViolation((error as { cause?: unknown }).cause, depth + 1);
}

export function coordinatorErrorCode(error: unknown): CoordinatorErrorCode {
  if (error instanceof CoordinatorTurnError || error instanceof CoordinatorProviderError) return error.code;
  if (error instanceof CommonsAuthenticationRequiredError) return "auth_expired";
  if (error instanceof CommonsMembershipRequiredError) return "membership_lost";
  if (error instanceof CoordinatorAccessError || error instanceof CoordinatorConflictError) return error.coordinatorCode;
  // The native lodging store re-checks membership inside its own transactions; a lost role mid-turn keeps its honest code.
  if (error instanceof TripCoordinationError && (error.code === "membership_lost" || error.code === "organizer_required")) return error.code;
  // Task capacity is a conflict subclass, but it is not a stale conversation.
  if (error instanceof TaskLimitError) return "rate_limited";
  // Bare access/conflict errors come from shared repositories; say what is honest for each.
  if (error instanceof CommandAccessError) return "artifact_missing";
  if (error instanceof CommandConflictError) return "stale_version";
  if (error instanceof PollInferenceLimitError) return "rate_limited";
  if (error instanceof ZodError || error instanceof SyntaxError) return "invalid_request";
  // A primary-key or unique conflict on an id derived from the command means the command id was reused for something else: a mismatch, never a provider failure.
  if (isUniqueViolation(error)) return "command_mismatch";
  return "internal_error";
}

/** Exceptions become stable codes with distinct copy. Never returns exception text, record contents, or identifiers. */
export function coordinatorErrorFrom(error: unknown): CoordinatorError {
  return coordinatorError(coordinatorErrorCode(error));
}

/** `{ error: CoordinatorError }` with the catalog status. Used by the turn routes. */
export function coordinatorErrorResponse(error: unknown): NextResponse {
  const wire = coordinatorErrorFrom(error);
  return NextResponse.json({ error: wire }, { status: coordinatorErrorCatalog[wire.code].httpStatus, headers });
}

/**
 * Same codes and copy for routes the current Workspace UI still reads as `{ error: string }`.
 * Carries `code` and `retryable` so clients can stop guessing from prose.
 */
export function legacyCoordinatorErrorResponse(error: unknown): NextResponse {
  const wire = coordinatorErrorFrom(error);
  return NextResponse.json({ error: wire.userMessage, code: wire.code, retryable: wire.retryable }, { status: coordinatorErrorCatalog[wire.code].httpStatus, headers });
}
