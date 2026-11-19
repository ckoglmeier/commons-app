import { AsyncLocalStorage } from "node:async_hooks";

/*
 * Conversation durability A2: the identity a durable Coordinator turn executes as, outside the request that submitted it.
 *
 * Only the turn runner sets this, and only from a claimed `coordinator_turn_executions` row: the person is the turn's stored owner and the auth user id is
 * the one the admitting request verified, both read from the database, never from a caller, header or payload. No HTTP route can set it. It replaces the
 * cookie lookup in `pollOptions` and the verified-identity readers; every repository the turn uses still re-checks active organizer membership, role,
 * artifact access and versions under its own locks, so this grants no trip authority by itself. A verified email is re-read from the auth provider
 * when the runner claims the work; without one, email-gated features (operator exemption, search, pilots) are off for that execution.
 */
export type TurnPrincipal = {
  kind: "durable_turn";
  actorPersonId: string; tripId: string; turnId: string; attempt: number;
  authUserId: string | null;
  /** Re-verified with the auth provider at claim, or null. */
  verifiedEmail: string | null;
};

const storage = new AsyncLocalStorage<TurnPrincipal>();

export function runAsTurnPrincipal<T>(principal: TurnPrincipal, work: () => Promise<T>): Promise<T> {
  return storage.run(Object.freeze({ ...principal }), work);
}

export function currentTurnPrincipal(): TurnPrincipal | null {
  return storage.getStore() ?? null;
}
