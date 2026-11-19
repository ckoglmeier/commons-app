import { and, eq } from "drizzle-orm";
import { SaveTripBudgetSchema, TripBudgetInputsSchema, type TripBudgetView } from "@commons/contracts";
import { createDatabase } from "./client";
import { CommandAccessError, CommandConflictError, type CommandTransaction } from "./event-command";
import { isCommonsId } from "./commons-identifier";
import { commons, memberships, tripBudgetWorksheets } from "./schema";

type Options = { databaseUrl?: string; actorPersonId: string };
async function tripAccess(db: Pick<CommandTransaction, "select">, identifier: string, actorPersonId: string, lock = false) {
  const query = db.select({ id: commons.id, role: memberships.role, status: memberships.status }).from(commons)
    .innerJoin(memberships, and(eq(memberships.commonsId, commons.id), eq(memberships.personId, actorPersonId)))
    .where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier));
  const [trip] = await (lock ? query.for("update", { of: commons }) : query);
  if (!trip || trip.status !== "active") throw new CommandAccessError();
  return trip;
}
function view(row: typeof tripBudgetWorksheets.$inferSelect | undefined, canEdit: boolean): TripBudgetView {
  return { inputs: row ? TripBudgetInputsSchema.parse(row.inputs) : null, version: row?.version ?? 0, updatedAt: row?.updatedAt.toISOString() ?? null, canEdit };
}
/** Active members read the shared estimate. Invitation holders and outsiders cannot. */
export async function readTripBudget(identifier: string, options: Options): Promise<TripBudgetView> {
  const database = createDatabase(options.databaseUrl);
  try {
    const trip = await tripAccess(database.db, identifier, options.actorPersonId);
    const [row] = await database.db.select().from(tripBudgetWorksheets).where(eq(tripBudgetWorksheets.commonsId, trip.id));
    return view(row, trip.role === "organizer");
  } finally { await database.close(); }
}
/** Versioned organizer save. This table has no path to expenses, payments or the trip's actual currency. */
export async function saveTripBudget(identifier: string, raw: unknown, options: Options): Promise<TripBudgetView> {
  const input = SaveTripBudgetSchema.parse(raw), database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const trip = await tripAccess(tx, identifier, options.actorPersonId, true);
      if (trip.role !== "organizer") throw new CommandAccessError();
      const [existing] = await tx.select().from(tripBudgetWorksheets).where(eq(tripBudgetWorksheets.commonsId, trip.id));
      // An uncertain response can be retried without recording another revision.
      if (existing && existing.version === input.expectedVersion + 1 && JSON.stringify(TripBudgetInputsSchema.parse(existing.inputs)) === JSON.stringify(input.inputs)) return view(existing, true);
      if ((existing?.version ?? 0) !== input.expectedVersion) throw new CommandConflictError();
      const value = { inputs: input.inputs, version: input.expectedVersion + 1, updatedByPersonId: options.actorPersonId, updatedAt: new Date() };
      const [saved] = existing
        ? await tx.update(tripBudgetWorksheets).set(value).where(eq(tripBudgetWorksheets.commonsId, trip.id)).returning()
        : await tx.insert(tripBudgetWorksheets).values({ commonsId: trip.id, ...value }).returning();
      return view(saved, true);
    });
  } finally { await database.close(); }
}
