import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ItineraryContentSchema, ItineraryDocumentRevisionSchema, ItineraryDraftSchema, validateItineraryContent, type ItineraryDraft } from "@commons/contracts";
import { createDatabase } from "./client";
import { coordinatorThreads, coordinatorTurns } from "./schema";
import { CommandAccessError, CommandConflictError, commandFingerprint, runEventCommand } from "./event-command";
import { itineraryDigest, itineraryFacts, latestItinerary } from "./research-itinerary-repository";
import { writeLifecycle } from "./coordinator-turn-lifecycle";
import type { PollRepositoryOptions } from "./poll-repository";

const CreateImportedItinerarySchema = z.object({
  commandId: z.string().uuid(), threadId: z.string().uuid(), content: ItineraryContentSchema,
  /** Digest of the reviewed import text, for provenance only; the source text itself is not stored. */
  sourceDigest: z.string().length(64),
}).strict();
const derivedId = (seed: string, id: string) => { const h = itineraryDigest([seed, id]); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
export const IMPORTED_ITINERARY_REPLY = "Imported a private itinerary draft. It’s open in Work for organizers only. Nothing was shared, added to the trip or booked.";

/**
 * Starts the thread's private itinerary document from a reviewed import, without a model call.
 * The document, its first completed turn and its first revision commit together; replay returns the same result.
 * A thread that already has an itinerary is refused: later imports go through the existing revise command.
 */
export async function createImportedItineraryDocument(identifier: string, raw: unknown, options: PollRepositoryOptions) {
  const input = CreateImportedItinerarySchema.parse(raw), database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => runEventCommand(tx, { identifier, actorPersonId: options.actorPersonId, commandId: input.commandId, action: "research_itinerary.imported", input },
    ({ role }) => { if (role !== "organizer") throw new CommandAccessError(); }, async ({ id: event, now }) => {
      const [thread] = await tx.select().from(coordinatorThreads).where(and(eq(coordinatorThreads.id, input.threadId), eq(coordinatorThreads.commonsId, event))).for("update");
      if (!thread) throw new CommandAccessError();
      if (thread.status !== "active" || await latestItinerary(tx, event, thread.id)) throw new CommandConflictError();
      const { facts, factsFingerprint } = await itineraryFacts(tx, event);
      const draft: ItineraryDraft = ItineraryDraftSchema.parse({ id: derivedId(input.commandId, "document"), version: 1, threadId: thread.id, ownerId: options.actorPersonId, facts, factsFingerprint,
        imports: [], corrections: [], evidence: [], receipts: [], content: input.content });
      draft.content = validateItineraryContent(draft.content, draft, { privateDocumentEdit: true });
      const [{ sequence }] = await tx.select({ sequence: sql<number>`coalesce(max(${coordinatorTurns.sequence}), 0)::int` }).from(coordinatorTurns).where(eq(coordinatorTurns.threadId, thread.id));
      const saved = writeLifecycle({ tripConversation: true, itineraryDraft: draft }, { v: 1, status: "completed", inputMode: "text", errorCode: null, attempt: 1, leaseExpiresAt: null,
        spokenReply: null, sources: [], completedAt: now.toISOString(), provisionalTitle: null }, IMPORTED_ITINERARY_REPLY);
      const [turn] = await tx.insert(coordinatorTurns).values({ commonsId: event, ownerPersonId: options.actorPersonId, threadId: thread.id, organizerShared: true, sequence: sequence + 1,
        commandId: input.commandId, fingerprint: commandFingerprint(options.actorPersonId, "coordinator.itinerary_import", { threadId: thread.id, sourceDigest: input.sourceDigest }),
        userText: "Import an itinerary file", assistantText: saved.assistantText, workspace: saved.workspace, createdAt: now }).returning({ id: coordinatorTurns.id });
      await tx.update(coordinatorThreads).set({ updatedAt: now }).where(eq(coordinatorThreads.id, thread.id));
      const revision = ItineraryDocumentRevisionSchema.parse({ commandId: input.commandId, documentId: draft.id, threadId: thread.id, version: 1, actorId: options.actorPersonId, source: "human",
        contextDigest: itineraryDigest([]), at: now.toISOString(), undoable: false, before: null, after: draft.content });
      return { result: { documentId: draft.id, threadId: thread.id, turnId: turn.id, version: 1, revision }, resourceType: "research_itinerary", resourceId: draft.id, summary: "Created an organizer-only itinerary draft from a reviewed import." };
    })); } finally { await database.close(); }
}
