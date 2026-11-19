import { SaveTripPlanningContextSchema, TripPlanningContextStateSchema, readTripPlanningBrief } from "@commons/contracts";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "./client";
import { auditEvents, commons, people, processedCommands } from "./schema";
import { requireTripOrganizer } from "./coordinator-turn-repository";
import { CommandConflictError, commandFingerprint } from "./event-command";
import type { PollRepositoryOptions } from "./poll-repository";

export async function tripPlanningContext(identifier: string, options: PollRepositoryOptions, raw?: unknown) {
  const input = raw === undefined ? null : SaveTripPlanningContextSchema.parse(raw);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      // Resolve active organizer before reading even a replay; lock serializes co-organizer edits.
      const tripId = await requireTripOrganizer(tx, identifier, options.actorPersonId);
      const [row] = await tx.select().from(commons).where(eq(commons.id, tripId));
      let brief = row.eventBrief ?? {};
      const metadataSchema = TripPlanningContextStateSchema.pick({ version: true, updatedAt: true, updatedByName: true });
      const parsed = metadataSchema.safeParse(brief.planningContextMetadata);
      let metadata = parsed.success ? parsed.data : { version: 0, updatedAt: null, updatedByName: null };
      if (input) {
        const fingerprint = commandFingerprint(options.actorPersonId, "trip.context.saved", input);
        const [prior] = await tx.select().from(processedCommands).where(and(eq(processedCommands.commonsId, tripId), eq(processedCommands.commandId, input.commandId)));
        if (prior) {
          if (prior.result.fingerprint !== fingerprint) throw new CommandConflictError();
          // Return the durable receipt, even if another organizer subsequently edited the brief.
          return TripPlanningContextStateSchema.parse(prior.result.context);
        }
        if (input.expectedVersion !== metadata.version) throw new CommandConflictError();
        const [actor] = await tx.select({ name: people.displayName }).from(people).where(eq(people.id, options.actorPersonId));
        const now = new Date();
        metadata = { version: metadata.version + 1, updatedAt: now.toISOString(), updatedByName: actor.name };
        // Preserve setup suggestions, unresolved questions and all unrelated legacy keys.
        brief = { ...brief, ...input.brief, planningContextMetadata: metadata };
        const context = TripPlanningContextStateSchema.parse({ defaultCurrency: row.currency, tripId, name: row.name, viewerId: options.actorPersonId, ...metadata, brief: input.brief });
        await tx.update(commons).set({ eventBrief: brief, updatedAt: now }).where(eq(commons.id, tripId));
        await tx.insert(processedCommands).values({ commonsId: tripId, commandId: input.commandId, result: { fingerprint, context } });
        await tx.insert(auditEvents).values({ commonsId: tripId, commandId: input.commandId, actorId: options.actorPersonId, actorType: "human", action: "trip.context.saved", resourceType: "commons", resourceId: tripId, summary: `${actor.name} updated the organizer planning context.` });
        return context;
      }
      return TripPlanningContextStateSchema.parse({ defaultCurrency: row.currency, tripId, name: row.name, viewerId: options.actorPersonId, ...metadata, brief: readTripPlanningBrief(brief) });
    });
  } finally { await database.close(); }
}
