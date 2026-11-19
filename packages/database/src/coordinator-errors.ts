import type { CoordinatorErrorCode } from "@commons/contracts";
import { CommandAccessError, CommandConflictError } from "./event-command";

/** A stable, user-facing failure. `code` maps to `coordinatorErrorCatalog`; the message never carries record contents. */
export class CoordinatorTurnError extends Error {
  constructor(readonly code: CoordinatorErrorCode) {
    super(`Coordinator turn rejected: ${code}`);
    this.name = "CoordinatorTurnError";
  }
}

/**
 * Subclasses keep every existing `instanceof CommandAccessError/CommandConflictError` check working
 * while letting the coordinator API report which check actually failed (R7).
 */
export class CoordinatorAccessError extends CommandAccessError {
  constructor(readonly coordinatorCode: CoordinatorErrorCode) { super(); }
}
export class CoordinatorConflictError extends CommandConflictError {
  constructor(readonly coordinatorCode: CoordinatorErrorCode = "stale_version") { super(); }
}
