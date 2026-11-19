import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { EvidenceRecordSchema, IntakeEvidenceCommandSchema, InventoryRequestSchema, QueueInventoryCheckCommandSchema,
  type EvidenceInput, type InventoryRequest } from "@commons/contracts";
import { assessInventoryObservation, inventoryRequestKey } from "@commons/domain";
import { createDatabase } from "./client";
import { commandFingerprint, CommandAccessError, CommandConflictError, runEventCommand, type CommandTransaction } from "./event-command";
import { isCommonsId } from "./commons-identifier";
import { commons, confirmationDocuments, discoveryEvidence, inventoryChecks, memberships } from "./schema";

export type DiscoveryOptions = { databaseUrl?: string; actorPersonId: string };

export async function requireDiscoveryMember(tx: CommandTransaction, eventId: string, personId: string) {
  const [member] = await tx.select({ id: memberships.id }).from(memberships)
    .where(and(eq(memberships.commonsId, eventId), eq(memberships.personId, personId), eq(memberships.status, "active"))).limit(1);
  if (!member) throw new CommandAccessError();
}

export async function authorizedDiscoveryEvidence(tx: CommandTransaction, eventId: string, evidenceId: string, personId: string) {
  await requireDiscoveryMember(tx, eventId, personId);
  const [row] = await tx.select().from(discoveryEvidence)
    .where(and(eq(discoveryEvidence.commonsId, eventId), eq(discoveryEvidence.id, evidenceId))).limit(1);
  if (!row || (row.audience === "private" && row.suppliedByPersonId !== personId)) throw new CommandAccessError();
  const record = EvidenceRecordSchema.parse(row.record);
  if (record.source.documentId) await requireDocument(tx, eventId, personId, record.source.documentId);
  return record;
}

async function requireDocument(tx: CommandTransaction, eventId: string, personId: string, documentId: string) {
  const [document] = await tx.select({ id: confirmationDocuments.id }).from(confirmationDocuments).where(and(
    eq(confirmationDocuments.commonsId, eventId), eq(confirmationDocuments.id, documentId),
    eq(confirmationDocuments.ownerPersonId, personId),
  )).limit(1);
  if (!document) throw new CommandAccessError();
}

async function resolveEvent(tx: CommandTransaction, identifier: string) {
  const [event] = await tx.select({ id: commons.id }).from(commons)
    .where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).limit(1);
  if (!event) throw new CommandAccessError();
  return event.id;
}

function normalizedUrl(source: EvidenceInput) {
  if (!source.url) return null;
  // Same normalization as existing link intake; do not drop query parameters (dates/occupancy).
  const url = new URL(source.url); url.hash = ""; return url.toString();
}

export async function intakeDiscoveryEvidence(identifier: string, raw: unknown, options: DiscoveryOptions) {
  const command = IntakeEvidenceCommandSchema.parse(raw);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(tx => runEventCommand(tx, {
      identifier, actorPersonId: options.actorPersonId, commandId: command.commandId,
      action: "discovery.evidence_captured", input: { source: command.source, indicativePrice: command.indicativePrice },
    }, async ({ id }) => {
      if (command.source.documentId) await requireDocument(tx, id, options.actorPersonId, command.source.documentId);
    }, async ({ id, now }) => {
      const source = command.source;
      const identityKey = commandFingerprint(options.actorPersonId, "discovery.source_identity", { channel: source.channel, externalId: source.externalId });
      // Exact content retries may arrive under a new transport ID. Preserve the first original
      // and its attribution; different publishers, audiences, channels, or content stay distinct.
      const contentHash = commandFingerprint(options.actorPersonId, "discovery.original", {
        source: { ...source, externalId: undefined, url: normalizedUrl(source) }, indicativePrice: command.indicativePrice,
      });
      const [identityMatch] = await tx.select().from(discoveryEvidence).where(and(
        eq(discoveryEvidence.commonsId, id), eq(discoveryEvidence.suppliedByPersonId, options.actorPersonId), eq(discoveryEvidence.identityKey, identityKey),
      )).limit(1);
      if (identityMatch && identityMatch.record.contentHash !== contentHash) throw new CommandConflictError();
      const [contentMatch] = identityMatch ? [] : await tx.select().from(discoveryEvidence).where(and(
        eq(discoveryEvidence.commonsId, id), eq(discoveryEvidence.suppliedByPersonId, options.actorPersonId),
        sql`${discoveryEvidence.record}->>'contentHash' = ${contentHash}`,
      )).limit(1);
      const previous = identityMatch ?? contentMatch;
      const evidenceId = previous?.id ?? randomUUID();
      if (!previous) {
        const record = EvidenceRecordSchema.parse({ id: evidenceId, eventId: id, suppliedByPersonId: options.actorPersonId,
          source, indicativePrice: command.indicativePrice, normalizedUrl: normalizedUrl(source), contentHash, receivedAt: now.toISOString(), trust: "untrusted_data" });
        await tx.insert(discoveryEvidence).values({ id: evidenceId, commonsId: id, suppliedByPersonId: options.actorPersonId,
          audience: source.audience, identityKey, record });
      }
      return { result: { evidenceId }, resourceType: "discovery_evidence", resourceId: evidenceId, summary: "Discovery evidence captured." };
    }));
  } finally { await database.close(); }
}

export async function readDiscoveryEvidence(identifier: string, evidenceId: string, options: DiscoveryOptions) {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => authorizedDiscoveryEvidence(tx, await resolveEvent(tx, identifier), evidenceId, options.actorPersonId));
  } finally { await database.close(); }
}

export async function queueInventoryCheck(identifier: string, raw: unknown, options: DiscoveryOptions) {
  const command = QueueInventoryCheckCommandSchema.parse(raw);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(tx => runEventCommand(tx, {
      identifier, actorPersonId: options.actorPersonId, commandId: command.commandId,
      action: "discovery.check_requested", input: { ...command, request: inventoryRequestKey(command.request) },
    }, async ({ id }) => {
      await authorizedDiscoveryEvidence(tx, id, command.evidenceId, options.actorPersonId);
      for (const participantId of command.request.party.participantIds) await requireDiscoveryMember(tx, id, participantId);
    }, async ({ id, now }) => {
      const cacheKey = commandFingerprint(options.actorPersonId, "inventory.exact_input", {
        evidenceId: command.evidenceId, providerId: command.providerId, request: inventoryRequestKey(command.request),
      });
      // runEventCommand serializes requests within this event, including distinct command IDs.
      const [cached] = await tx.select().from(inventoryChecks).where(and(eq(inventoryChecks.commonsId, id),
        eq(inventoryChecks.requestedByPersonId, options.actorPersonId), eq(inventoryChecks.cacheKey, cacheKey)))
        .orderBy(desc(inventoryChecks.createdAt)).limit(1);
      const pending = cached && ["pending", "processing"].includes(cached.status);
      const fresh = cached?.observation && cached.status === "succeeded"
        && assessInventoryObservation(cached.observation, command.request, now, command.selection).applicability === "applicable";
      if (cached && (pending || fresh)) return { result: { checkId: cached.id, reuse: pending ? "pending" : "fresh" },
        resourceType: "inventory_check", resourceId: cached.id, summary: "Existing inventory evidence check reused." };
      const [check] = await tx.insert(inventoryChecks).values({ commonsId: id, evidenceId: command.evidenceId,
        requestedByPersonId: options.actorPersonId, providerId: command.providerId, request: command.request, cacheKey,
        selection: command.selection }).returning({ checkId: inventoryChecks.id });
      return { result: { ...check, reuse: "created" }, resourceType: "inventory_check", resourceId: check.checkId, summary: "Inventory evidence check requested." };
    }));
  } finally { await database.close(); }
}

// The caller must supply its current candidate request. Never assess freshness using saved inputs implicitly.
export async function readInventoryCheck(identifier: string, checkId: string, currentRequest: InventoryRequest, options: DiscoveryOptions, now = new Date()) {
  const current = InventoryRequestSchema.parse(currentRequest);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const eventId = await resolveEvent(tx, identifier);
      await requireDiscoveryMember(tx, eventId, options.actorPersonId);
      const [check] = await tx.select().from(inventoryChecks).where(and(eq(inventoryChecks.commonsId, eventId), eq(inventoryChecks.id, checkId))).limit(1);
      if (!check) throw new CommandAccessError();
      await authorizedDiscoveryEvidence(tx, eventId, check.evidenceId, options.actorPersonId);
      return { ...check, assessment: check.observation ? assessInventoryObservation(check.observation, current, now, check.selection) : null };
    });
  } finally { await database.close(); }
}
