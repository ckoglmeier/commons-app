import test from "node:test";
import assert from "node:assert/strict";
import { CoordinatorAccessError, CoordinatorConflictError, CoordinatorTurnError } from "@commons/database";
import { coordinatorFailureCode } from "./coordinator-failure";

test("diagnostics never include arbitrary private exception content", () => {
  assert.equal(coordinatorFailureCode(new Error("private conversation and credentials")), "unknown");
  assert.equal(coordinatorFailureCode(new TypeError("private payload")), "type_error");
  assert.equal(coordinatorFailureCode(new Error("The suggested edit does not match this draft.")), "edit_target_missing");
  assert.equal(coordinatorFailureCode({ message: "private" }), "unknown");
});

test("stable coordinator codes are logged as themselves, not as unknown", () => {
  assert.equal(coordinatorFailureCode(new CoordinatorTurnError("provider_failed")), "provider_failed");
  assert.equal(coordinatorFailureCode(new CoordinatorAccessError("organizer_required")), "organizer_required");
  assert.equal(coordinatorFailureCode(new CoordinatorConflictError("stale_version")), "stale_version");
});
