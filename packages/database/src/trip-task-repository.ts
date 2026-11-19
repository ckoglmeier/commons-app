import { or, and, eq, inArray } from "drizzle-orm";
import { SaveTripTaskSchema, TripTaskSchema } from "@commons/contracts";
import { createDatabase } from "./client";
import { commons, memberships, itineraryItems, travelPlans, stays, tripTasks } from "./schema";
import { CommandAccessError, CommandConflictError, runEventCommand, type CommandTransaction } from "./event-command";
import { isCommonsId } from "./commons-identifier";
import type { PollRepositoryOptions } from "./poll-repository";
async function linkedTitle(tx: CommandTransaction, tripId: string, kind: "plan" | "travel" | "stay" | null, id: string | null) {
    if (kind === null || id === null) return null;
    if (kind === "plan") {
        const [row] = await tx.select().from(itineraryItems).where(and(eq(itineraryItems.commonsId, tripId), eq(itineraryItems.id, id)));
        return row?.title;
    }
    if (kind === "stay") {
        const [row] = await tx.select().from(stays).where(and(eq(stays.commonsId, tripId), eq(stays.id, id)));
        return row?.name;
    }
    const [row] = await tx.select().from(travelPlans).where(and(eq(travelPlans.commonsId, tripId), eq(travelPlans.id, id), or(inArray(travelPlans.kind, ["arrival", "departure"]), inArray(travelPlans.visibility, ["basic", "all"]))));
    return row?.route;
}
export async function listTripTasks(identifier: string, options: PollRepositoryOptions) {
    const db = createDatabase(options.databaseUrl);
    try {
        return await db.db.transaction(async (tx) => {
            const [trip] = await tx.select().from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier));
            const [actor] = trip ? await tx.select().from(memberships).where(and(eq(memberships.commonsId, trip.id), eq(memberships.personId, options.actorPersonId), eq(memberships.status, "active"))) : [];
            if (!actor)
                throw new CommandAccessError();
            const rows = await tx.select().from(tripTasks).where(and(eq(tripTasks.commonsId, trip.id), actor.role === "organizer" ? undefined : eq(tripTasks.ownerPersonId, options.actorPersonId)));
            const result = [];
            for (const row of rows) {
                const itemTitle = await linkedTitle(tx, trip.id, row.itemKind, row.itemId);
                if (row.itemKind === null || itemTitle)
                    result.push(TripTaskSchema.parse({ ...row, itemTitle, suggestedByCommons: row.brainFindingKey !== null, suggestionKey: row.brainFindingKey }));
            }
            return result;
        });
    }
    finally {
        await db.close();
    }
}
export async function saveTripTask(identifier: string, raw: unknown, options: PollRepositoryOptions) {
    const db = createDatabase(options.databaseUrl);
    try { return await db.db.transaction(tx => saveTripTaskInTransaction(tx, identifier, raw, options)); }
    finally { await db.close(); }
}
export async function saveTripTaskInTransaction(tx: CommandTransaction, identifier: string, raw: unknown, options: PollRepositoryOptions) {
    const input = SaveTripTaskSchema.parse(raw);
    return runEventCommand(tx, {
            identifier, actorPersonId: options.actorPersonId, commandId: input.commandId, action: "trip_task.saved", input,
        }, async ({ id, role }) => {
            if (role !== "organizer") {
                if (input.ownerPersonId !== options.actorPersonId) throw new CommandAccessError();
                const [old] = await tx.select().from(tripTasks).where(eq(tripTasks.id,input.id));
                if (old && (old.commonsId !== id || old.ownerPersonId !== options.actorPersonId)) throw new CommandAccessError();
            }
        }, async ({ id, now }) => {
            const [owner] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, id), eq(memberships.personId, input.ownerPersonId), inArray(memberships.status, ["active", "invited"])));
            const itemTitle = await linkedTitle(tx, id, input.itemKind, input.itemId);
            if (!owner || (input.itemKind !== null && !itemTitle))
                throw new CommandAccessError();
            const [old] = await tx.select().from(tripTasks).where(eq(tripTasks.id, input.id));
            if (old && (old.commonsId !== id || old.version !== input.expectedVersion) || !old && input.expectedVersion !== 0)
                throw new CommandConflictError();
            const values = { title: input.title, ownerPersonId: input.ownerPersonId, dueOn: input.dueOn, completed: input.completed, itemKind: input.itemKind, itemId: input.itemId, updatedAt: now };
            const [row] = old ? await tx.update(tripTasks).set({ ...values, version: old.version + 1 }).where(eq(tripTasks.id, old.id)).returning() : await tx.insert(tripTasks).values({ ...values, id: input.id, commonsId: id, createdByPersonId: options.actorPersonId }).returning();
            return { result: TripTaskSchema.parse({ ...row, itemTitle, suggestedByCommons: row.brainFindingKey !== null, suggestionKey: row.brainFindingKey }), resourceType: "trip_task", resourceId: row.id, summary: `${input.completed ? "Completed" : "Saved"} task: ${input.title}` };
        });
}
