import { CoordinatorRecommendationSchema, SaveCoordinatorRecommendationSchema } from "@commons/contracts";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "./client";
import { commandFingerprint, CommandAccessError, CommandConflictError } from "./event-command";
import { isCommonsId } from "./commons-identifier";
import { coordinatorRecommendations, commons, memberships, operatorAuditEvents, people, polls, processedCommands } from "./schema";
import { readPollEvidence } from "./poll-evidence";

async function organizer(tx: Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0], identifier: string, personId: string) {
  const [event] = await tx.select({ id: commons.id }).from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).for("update");
  const [member] = event ? await tx.select().from(memberships).where(and(eq(memberships.commonsId, event.id), eq(memberships.personId, personId))) : [];
  if (!event || member?.status !== "active" || member.role !== "organizer") throw new CommandAccessError();
  return event.id;
}
function output(row: typeof coordinatorRecommendations.$inferSelect, evidenceCurrent?: boolean) {
  return CoordinatorRecommendationSchema.parse({ id: row.id, sourcePollId: row.sourcePollId, preparedBy: row.preparedBy, evidenceFingerprint: row.evidenceFingerprint,
    recommendation: row.recommendation, freshness: row.freshness, uncertainties: row.uncertainties, openQuestions: row.openQuestions, nextAction: row.nextAction,
    version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), ...(evidenceCurrent === undefined ? {} : { evidenceCurrent }) });
}
export async function listCoordinatorRecommendations(identifier: string, options: { databaseUrl?: string; actorPersonId: string }) {
  const database = createDatabase(options.databaseUrl); try { return await database.db.transaction(async tx => {
    const event = await organizer(tx, identifier, options.actorPersonId); const rows = await tx.select().from(coordinatorRecommendations).where(and(eq(coordinatorRecommendations.commonsId, event), eq(coordinatorRecommendations.ownerPersonId, options.actorPersonId)));
    return Promise.all(rows.map(async row => {
      const [poll] = await tx.select().from(polls).where(and(eq(polls.id, row.sourcePollId), eq(polls.commonsId, event))).limit(1);
      // A deleted source is stale as well. Never return source responses through this
      // private-artifact API; its poll link remains the inspectable evidence surface.
      const evidenceCurrent = Boolean(poll) && (await readPollEvidence(tx, poll!)).fingerprint === row.evidenceFingerprint;
      return output(row, evidenceCurrent);
    }));
  }); } finally { await database.close(); }
}

/**
 * Restricted operator path. The target organizer is explicit and remains the
 * private-thread owner; the operator is recorded separately in the server-only
 * operator audit log, so an operator is never represented as that organizer.
 */
export async function saveOperatorPreparedCoordinatorRecommendation(identifier: string, raw: unknown, input: {
  databaseUrl?: string; operatorPersonId: string; organizerPersonId: string;
}) {
  const recommendation = SaveCoordinatorRecommendationSchema.parse(raw), database = createDatabase(input.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const [operator] = await tx.select({ id: people.id }).from(people).where(eq(people.id, input.operatorPersonId)).limit(1);
    if (!operator) throw new CommandAccessError();
    const event = await organizer(tx, identifier, input.organizerPersonId);
    const fingerprint = commandFingerprint(input.operatorPersonId, "coordinator.operator_recommendation", { organizerPersonId: input.organizerPersonId, recommendation });
    const [receipt] = await tx.select({ result: processedCommands.result }).from(processedCommands).where(and(eq(processedCommands.commonsId, event), eq(processedCommands.commandId, recommendation.commandId)));
    if (receipt) { const replay = receipt.result as { fingerprint?: string; result?: unknown }; if (replay.fingerprint !== fingerprint || !replay.result) throw new CommandConflictError(); return CoordinatorRecommendationSchema.parse(replay.result); }
    const [poll] = await tx.select().from(polls).where(and(eq(polls.id, recommendation.sourcePollId), eq(polls.commonsId, event))).for("update");
    if (!poll) throw new CommandAccessError();
    const evidence = await readPollEvidence(tx, poll);
    if (evidence.fingerprint !== recommendation.evidenceFingerprint) throw new CommandConflictError();
    const [current] = await tx.select().from(coordinatorRecommendations).where(and(eq(coordinatorRecommendations.commonsId, event), eq(coordinatorRecommendations.ownerPersonId, input.organizerPersonId), eq(coordinatorRecommendations.sourcePollId, recommendation.sourcePollId))).for("update");
    if ((!current && recommendation.expectedVersion !== 0) || (current && current.version !== recommendation.expectedVersion)) throw new CommandConflictError();
    const values = { commandId: recommendation.commandId, fingerprint, preparedBy: recommendation.preparedBy, evidenceFingerprint: recommendation.evidenceFingerprint, recommendation: recommendation.recommendation, freshness: recommendation.freshness, uncertainties: recommendation.uncertainties, openQuestions: recommendation.openQuestions, nextAction: recommendation.nextAction };
    const row = current ? (await tx.update(coordinatorRecommendations).set({ ...values, version: current.version + 1, updatedAt: new Date() }).where(eq(coordinatorRecommendations.id, current.id)).returning())[0] : (await tx.insert(coordinatorRecommendations).values({ ...values, commonsId: event, ownerPersonId: input.organizerPersonId, sourcePollId: recommendation.sourcePollId }).returning())[0];
    await tx.insert(operatorAuditEvents).values({ actorPersonId: input.operatorPersonId, action: "coordinator_recommendation.prepared", resourceType: "coordinator_recommendation", resourceId: row.id, reason: `Organizer ${input.organizerPersonId}; source poll ${recommendation.sourcePollId}` });
    const result = output(row, true);
    await tx.insert(processedCommands).values({ commonsId: event, commandId: recommendation.commandId, result: { fingerprint, result } });
    return result;
  }); } finally { await database.close(); }
}
