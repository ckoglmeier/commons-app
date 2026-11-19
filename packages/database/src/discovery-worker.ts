import { eq } from "drizzle-orm";
import { type EvidenceExtractor, type EvidenceRecord, type VerificationFailure, type VerificationProvider } from "@commons/contracts";
import { verifyInventoryEvidence, type VerificationAttemptResult } from "@commons/domain";
import { createDatabase } from "./client";
import { DELIVERY_LEASE_MS, DELIVERY_MAX_ATTEMPTS, DELIVERY_RETRY_MS, ownsDeliveryLease } from "./delivery-lease";
import { authorizedDiscoveryEvidence, requireDiscoveryMember } from "./discovery-repository";
import { inventoryChecks } from "./schema";

// Narrow check-ID worker. No global agent queue, credential discovery, or external side effects.
export async function leaseInventoryCheck(checkId: string, databaseUrl?: string, now = new Date()) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [row] = await tx.select().from(inventoryChecks).where(eq(inventoryChecks.id, checkId)).for("update").limit(1);
      if (!row || row.status === "succeeded" || row.status === "failed" || row.availableAt > now
        || (row.status === "processing" && row.leaseExpiresAt && row.leaseExpiresAt > now)) return null;
      let errorCode: VerificationFailure | null = row.attempts >= DELIVERY_MAX_ATTEMPTS ? "attempts_exhausted" : null;
      let evidence: EvidenceRecord | null = null;
      try {
        evidence = await authorizedDiscoveryEvidence(tx, row.commonsId, row.evidenceId, row.requestedByPersonId);
        for (const participantId of row.request.party.participantIds) await requireDiscoveryMember(tx, row.commonsId, participantId);
      } catch { errorCode = "source_access_denied"; }
      const history = [...row.history];
      if (row.status === "processing") history.push({ attempt: row.attempts, result: null, errorCode: "lease_expired", finishedAt: now.toISOString() });
      if (errorCode || !evidence) {
        await tx.update(inventoryChecks).set({ status: "failed", errorCode, leaseExpiresAt: null, history, updatedAt: now }).where(eq(inventoryChecks.id, checkId));
        return null;
      }
      await tx.update(inventoryChecks).set({ status: "processing", attempts: row.attempts + 1, history,
        leaseExpiresAt: new Date(now.getTime() + DELIVERY_LEASE_MS), updatedAt: now }).where(eq(inventoryChecks.id, checkId));
      return { checkId, leaseAttempt: row.attempts + 1, request: row.request, providerId: row.providerId, evidence };
    });
  } finally { await database.close(); }
}

// Internal completion is fenced by attempt number and lease; callers cannot promote observations.
async function completeInventoryCheck(checkId: string, attempt: number, result: VerificationAttemptResult | null,
  failure: VerificationFailure | null, databaseUrl: string | undefined, now: Date) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [row] = await tx.select().from(inventoryChecks).where(eq(inventoryChecks.id, checkId)).for("update").limit(1);
      if (!row || !ownsDeliveryLease(row, attempt, now)) return false;
      let errorCode = failure ?? result?.errorCode ?? null;
      try {
        await authorizedDiscoveryEvidence(tx, row.commonsId, row.evidenceId, row.requestedByPersonId);
        for (const participantId of row.request.party.participantIds) await requireDiscoveryMember(tx, row.commonsId, participantId);
      } catch { errorCode = "source_access_denied"; }
      const retryable = errorCode && ["provider_timeout", "provider_failed", "model_timeout", "model_failed"].includes(errorCode);
      const status = !errorCode && result?.observation ? "succeeded"
        : retryable && row.attempts < DELIVERY_MAX_ATTEMPTS ? "pending" : "failed";
      await tx.update(inventoryChecks).set({ status, errorCode, leaseExpiresAt: null,
        availableAt: new Date(now.getTime() + DELIVERY_RETRY_MS), updatedAt: now,
        observation: status === "succeeded" ? result!.observation : null,
        history: [...row.history, { attempt, result, errorCode, finishedAt: now.toISOString() }],
      }).where(eq(inventoryChecks.id, checkId));
      return true;
    });
  } finally { await database.close(); }
}

export async function runInventoryCheck(checkId: string, adapters: ReadonlyMap<string, { provider: VerificationProvider; extractor?: EvidenceExtractor }>,
  options: { databaseUrl?: string; now?: () => Date; timeoutMs?: number } = {}) {
  const clock = options.now ?? (() => new Date());
  const lease = await leaseInventoryCheck(checkId, options.databaseUrl, clock());
  if (!lease) return { processed: false };
  const adapter = adapters.get(lease.providerId);
  const result = adapter && adapter.provider.id === lease.providerId
    ? await verifyInventoryEvidence({ ...adapter, evidence: lease.evidence, request: lease.request, timeoutMs: options.timeoutMs, now: clock }) : null;
  return { processed: await completeInventoryCheck(checkId, lease.leaseAttempt, result,
    result ? null : "provider_unavailable", options.databaseUrl, clock()) };
}
