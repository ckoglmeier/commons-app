import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { operatorAuditEvents } from "./schema";

// One non-renewing, server-only allowance. Flag changes/redeploys never reset it.
export const RESEARCH_BETA_BUDGET = "research-beta-2026-10-23";
export const RESEARCH_BETA_LIMIT_MICRO_USD = 10_000_000;
export class ResearchBetaLimitError extends Error {
  constructor() { super("Research allowance unavailable"); this.name = "ResearchBetaLimitError"; }
}
type Entry = { action: string; resourceId: string; reason: string | null };
export function researchBetaAccounting(rows: Entry[]) {
  const holds = new Map<string, number>(), settled = new Set<string>();
  for (const row of rows) {
    const value = JSON.parse(row.reason ?? "null");
    if (!Number.isSafeInteger(value?.microUsd) || value.microUsd < 0) throw new ResearchBetaLimitError();
    if (row.action === "research_beta.reserved") {
      if (holds.has(row.resourceId) || value.microUsd === 0) throw new ResearchBetaLimitError();
      holds.set(row.resourceId,value.microUsd);
    } else if (row.action === "research_beta.settled") {
      if (!holds.has(row.resourceId) || settled.has(row.resourceId)) throw new ResearchBetaLimitError();
      holds.set(row.resourceId,value.microUsd); settled.add(row.resourceId);
    } else throw new ResearchBetaLimitError();
  }
  return { accountedMicroUsd: [...holds.values()].reduce((a,b)=>a+b,0), unresolvedReservations: holds.size-settled.size };
}
async function locked<T>(databaseUrl: string | undefined, run: (tx: Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0])=>Promise<T>) {
  const database=createDatabase(databaseUrl);
  try { return await database.db.transaction(async tx=> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${RESEARCH_BETA_BUDGET}))`);
    return run(tx);
  }); } finally { await database.close(); }
}
export async function reserveResearchBetaSpend(actorPersonId: string, minimumMicroUsd: number, databaseUrl?: string) {
  if (!Number.isSafeInteger(minimumMicroUsd) || minimumMicroUsd < 1) throw new ResearchBetaLimitError();
  return locked(databaseUrl,async tx=> {
    const rows=await tx.select().from(operatorAuditEvents).where(eq(operatorAuditEvents.resourceType,RESEARCH_BETA_BUDGET)).orderBy(operatorAuditEvents.occurredAt,operatorAuditEvents.id);
    const accounting=researchBetaAccounting(rows), remaining=RESEARCH_BETA_LIMIT_MICRO_USD-accounting.accountedMicroUsd;
    // Unknown billing or one in-flight call holds the entire remainder. No TTL/refund.
    if (accounting.unresolvedReservations || remaining < minimumMicroUsd) throw new ResearchBetaLimitError();
    const id=randomUUID();
    await tx.insert(operatorAuditEvents).values({actorPersonId,action:"research_beta.reserved",resourceType:RESEARCH_BETA_BUDGET,resourceId:id,reason:JSON.stringify({microUsd:remaining})});
    return id;
  });
}
export async function settleResearchBetaSpend(id: string, actorPersonId: string, microUsd: number, databaseUrl?: string) {
  if (!Number.isSafeInteger(microUsd) || microUsd < 0) throw new ResearchBetaLimitError();
  return locked(databaseUrl,async tx=> {
    const rows=await tx.select().from(operatorAuditEvents).where(eq(operatorAuditEvents.resourceType,RESEARCH_BETA_BUDGET)).orderBy(operatorAuditEvents.occurredAt,operatorAuditEvents.id);
    researchBetaAccounting(rows);
    const hold=rows.find(row=>row.resourceId===id && row.action==="research_beta.reserved");
    if (!hold || hold.actorPersonId!==actorPersonId || rows.some(row=>row.resourceId===id && row.action==="research_beta.settled")) throw new ResearchBetaLimitError();
    await tx.insert(operatorAuditEvents).values({actorPersonId,action:"research_beta.settled",resourceType:RESEARCH_BETA_BUDGET,resourceId:id,reason:JSON.stringify({microUsd})});
  });
}
