import { randomUUID } from "node:crypto";
import { TripConstraintInputSchema, type TripConstraint } from "@commons/contracts";
import { commandFingerprint } from "./event-command";
import { insertKeyed, listKeyed, readKeyed, recordKey, resolveActor, TripCoordinationError, withTransaction, type CoordinationOptions, type KeyedRecord } from "./coordination-store";

/*
 * Trip constraints the lodging journey researches against (max nightly price, minimum bedrooms, notes). A shared constraint is part of the state research
 * is fresh against; a private one belongs to its author and never reaches shared research, a proposal, a brief or a model. There is no participant interface
 * for this yet: tests and local QA call it directly. That is a gap, not a widening of web access.
 */

export type ConstraintRecord = KeyedRecord & { kind: "commons.trip_constraint"; fingerprint: string; constraint: TripConstraint };

export async function listTripConstraints(tx: Parameters<typeof listKeyed>[0], tripId: string): Promise<TripConstraint[]> {
  return (await listKeyed<ConstraintRecord>(tx, tripId, "constraint")).map(item => item.constraint);
}

/**
 * Records a constraint, idempotent by command id. Any active member may state their own, attributed to them; a private constraint is stored for its author
 * only. Reusing a command id with different content is a conflict, never a silent overwrite.
 */
export async function submitTripConstraint(identifier: string, commandId: string, rawInput: unknown, options: CoordinationOptions): Promise<TripConstraint> {
  const input = TripConstraintInputSchema.parse(rawInput);
  return withTransaction(options, async tx => {
    const actor = await resolveActor(tx, identifier, options.actorPersonId, "member");
    if (input.audience !== "shared" && input.audience !== `private:${options.actorPersonId}`) throw new TripCoordinationError("audience_forbidden");
    const key = recordKey("constraint", commandId), fingerprint = commandFingerprint(options.actorPersonId, "commons.trip_constraint", input);
    const existing = await readKeyed<ConstraintRecord>(tx, actor.tripId, key);
    if (existing) { if (existing.fingerprint !== fingerprint) throw new TripCoordinationError("conflict"); return existing.constraint; }
    const all = await listTripConstraints(tx, actor.tripId);
    const constraint: TripConstraint = { id: randomUUID(), kind: input.kind, text: input.text, value: input.value, audience: input.audience, authorPersonId: options.actorPersonId, authorName: actor.name,
      version: all.length + 1, createdAt: new Date().toISOString() };
    await insertKeyed(tx, actor.tripId, key, { kind: "commons.trip_constraint", fingerprint, constraint });
    return constraint;
  });
}
