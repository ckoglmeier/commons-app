import test from "node:test";
import assert from "node:assert/strict";
import { coordinatorErrorCatalog, CoordinatorErrorCodeSchema, type CoordinatorErrorCode } from "@commons/contracts";
import { CommandAccessError, CommandConflictError, CoordinatorAccessError, CoordinatorConflictError, CoordinatorTurnError, PollInferenceLimitError, TaskLimitError } from "@commons/database";
import { ZodError } from "zod";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "./commons-access-errors";
import { coordinatorErrorCode, coordinatorErrorFrom, coordinatorErrorResponse, CoordinatorProviderError, legacyCoordinatorErrorResponse } from "./coordinator-errors";

test("exceptions map to distinct stable codes, statuses, and copy", async () => {
  const cases: Array<[unknown, CoordinatorErrorCode]> = [
    [new CommonsAuthenticationRequiredError(), "auth_expired"], [new CommonsMembershipRequiredError(), "membership_lost"],
    [new CoordinatorTurnError("thread_archived"), "thread_archived"], [new CoordinatorAccessError("organizer_required"), "organizer_required"],
    [new CoordinatorAccessError("artifact_misassociated"), "artifact_misassociated"], [new CoordinatorConflictError("stale_version"), "stale_version"],
    [new CoordinatorProviderError("provider_not_configured"), "provider_not_configured"], [new PollInferenceLimitError(), "rate_limited"], [new TaskLimitError(), "rate_limited"],
    [new CommandAccessError(), "artifact_missing"], [new CommandConflictError(), "stale_version"], [new SyntaxError("x"), "invalid_request"],
    [new ZodError([]), "invalid_request"], [new Error("private conversation and credentials"), "internal_error"], ["not an error", "internal_error"],
  ];
  for (const [error, code] of cases) {
    assert.equal(coordinatorErrorCode(error), code);
    const wire = coordinatorErrorFrom(error);
    assert.deepEqual(wire, { code, retryable: coordinatorErrorCatalog[code ].retryable, userMessage: coordinatorErrorCatalog[code ].userMessage });
    const response = coordinatorErrorResponse(error);
    assert.equal(response.status, coordinatorErrorCatalog[code ].httpStatus);
    assert.deepEqual((await response.json()).error, wire);
    const legacy = legacyCoordinatorErrorResponse(error);
    assert.deepEqual(await legacy.json(), { error: wire.userMessage, code, retryable: wire.retryable });
  }
  // Only sign-in expiry may talk about signing in; only organizer_required talks about organizers; nothing invents an account diagnosis.
  for (const code of CoordinatorErrorCodeSchema.options.filter(code => code !== "auth_expired")) assert.doesNotMatch(coordinatorErrorCatalog[code].userMessage, /sign in|your account/i);
  assert.equal(new Set(CoordinatorErrorCodeSchema.options.map(code => coordinatorErrorCatalog[code].userMessage)).size, CoordinatorErrorCodeSchema.options.length, "every code has its own copy");
  assert.doesNotMatch(JSON.stringify(coordinatorErrorFrom(new Error("secret-token-123"))), /secret-token/);
});

test("R11 a primary-key or unique conflict (directly or wrapped by the query layer) is command_mismatch, never a retryable provider failure", () => {
  const pg = Object.assign(new Error("duplicate key value violates unique constraint \"coordinator_threads_pkey\""), { code: "23505" });
  assert.equal(coordinatorErrorCode(pg), "command_mismatch");
  assert.equal(coordinatorErrorCode(Object.assign(new Error("Failed query"), { cause: pg })), "command_mismatch", "drizzle wraps the driver error");
  assert.equal(coordinatorErrorCode(Object.assign(new Error("deadlock"), { code: "40P01" })), "internal_error", "other database errors keep their meaning");
});
