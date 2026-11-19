import { createHash } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { createDatabase } from "./client";
import { isCommonsId } from "./commons-identifier";
import type { CommandTransaction } from "./event-command";
import { commons, memberships, people, processedCommands } from "./schema";

/*
 * Small keyed records the Commons-native lodging journey keeps on `processed_commands` (trip constraints and saved shortlists), plus the membership check every function runs inside its own transaction. The table is unique on (trip, command id), so these need no migration;
 * every key starts with `commons:<family>:`, which no event command id can collide with, and the hourly `poll_inference` count filters on its own `kind`.
 */

export type TripCoordinationCode = "membership_lost" | "organizer_required" | "audience_forbidden" | "not_found" | "stale_research" | "conflict" | "dates_required";
export class TripCoordinationError extends Error {
  constructor(readonly code: TripCoordinationCode, message?: string) { super(message ?? code); this.name = "TripCoordinationError"; }
}

/** The verified actor and database. Always derived on the server from the signed-in session, never from a request body or model output. */
export type CoordinationOptions = { databaseUrl?: string; actorPersonId: string };
export type Actor = { tripId: string; role: "organizer" | "member"; name: string };

/** Active membership (and, when asked, the organizer role) of the person on this trip, checked now. `lock` takes the trip row lock for writes. */
export async function resolveActor(tx: CommandTransaction, identifier: string, personId: string, need: "organizer" | "member", lock = true): Promise<Actor> {
  const query = tx.select({ id: commons.id }).from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).limit(1);
  const [trip] = lock ? await query.for("update") : await query;
  if (!trip) throw new TripCoordinationError("membership_lost");
  const [member] = await tx.select({ role: memberships.role, status: memberships.status, name: people.displayName }).from(memberships)
    .innerJoin(people, eq(people.id, memberships.personId)).where(and(eq(memberships.commonsId, trip.id), eq(memberships.personId, personId))).limit(1);
  if (!member || member.status !== "active") throw new TripCoordinationError("membership_lost");
  if (need === "organizer" && member.role !== "organizer") throw new TripCoordinationError("organizer_required");
  return { tripId: trip.id, role: member.role, name: member.name };
}

export async function withTransaction<T>(options: { databaseUrl?: string }, work: (tx: CommandTransaction) => Promise<T>): Promise<T> {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(work); } finally { await database.close(); }
}

/** The trip's id and slug for server-side rollout configuration. Reveals nothing beyond existence; callers authenticate separately. */
export async function tripKeys(identifier: string, options: { databaseUrl?: string }): Promise<{ id: string; slug: string } | null> {
  return withTransaction(options, async tx => {
    const [trip] = await tx.select({ id: commons.id, slug: commons.slug }).from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).limit(1);
    return trip ?? null;
  });
}

export type KeyedRecord = Record<string, unknown> & { kind: string };
export const recordKey = (family: string, id: string) => `commons:${family}:${id}`;

export async function readKeyed<T extends KeyedRecord>(tx: CommandTransaction, tripId: string, commandId: string): Promise<T | null> {
  const [row] = await tx.select({ result: processedCommands.result }).from(processedCommands).where(and(eq(processedCommands.commonsId, tripId), eq(processedCommands.commandId, commandId))).limit(1);
  return (row?.result as T | undefined) ?? null;
}
export async function listKeyed<T extends KeyedRecord>(tx: CommandTransaction, tripId: string, family: string): Promise<T[]> {
  const rows = await tx.select({ result: processedCommands.result }).from(processedCommands).where(and(eq(processedCommands.commonsId, tripId), like(processedCommands.commandId, recordKey(family, "%"))));
  return rows.map(row => row.result as T);
}
export async function insertKeyed(tx: CommandTransaction, tripId: string, commandId: string, result: KeyedRecord) {
  await tx.insert(processedCommands).values({ commonsId: tripId, commandId, result });
}

export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
