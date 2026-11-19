import { eq, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { coordinatorWorkerHealth } from "./schema";
export async function researchWorkerHealthy(databaseUrl?:string,now=new Date()) {const db=createDatabase(databaseUrl);try{const [exists]=await db.db.execute<{present:boolean}>(sql`select to_regclass('public.coordinator_worker_health') is not null as present`);if(!exists?.present)return false;const [pulse]=await db.db.select().from(coordinatorWorkerHealth).where(eq(coordinatorWorkerHealth.kind,"research"));return Boolean(pulse && pulse.seenAt<=now && now.getTime()-pulse.seenAt.getTime()<90_000);}finally{await db.close();}}
export async function recordResearchWorkerHeartbeat(databaseUrl?:string,now=new Date()){const db=createDatabase(databaseUrl);try{const [exists]=await db.db.execute<{present:boolean}>(sql`select to_regclass('public.coordinator_worker_health') is not null as present`);if(exists?.present)await db.db.insert(coordinatorWorkerHealth).values({kind:"research",seenAt:now}).onConflictDoUpdate({target:coordinatorWorkerHealth.kind,set:{seenAt:now}});}finally{await db.close();}}

function workflowKind(handler: { key: string; version: number }) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(handler.key) || !Number.isSafeInteger(handler.version) || handler.version < 1) throw new Error("Invalid workflow heartbeat scope.");
  return `workflow:${handler.key}:${handler.version}`;
}
/** A legacy worker or a different recipe handler cannot attest to this runner. */
export async function workflowWorkerHealthy(handler: { key: string; version: number }, databaseUrl?: string, now = new Date()) {
  const kind = workflowKind(handler), db = createDatabase(databaseUrl);
  try {
    const [exists] = await db.db.execute<{ present: boolean }>(sql`select to_regclass('public.coordinator_worker_health') is not null as present`);
    if (!exists?.present) return false;
    const [pulse] = await db.db.select().from(coordinatorWorkerHealth).where(eq(coordinatorWorkerHealth.kind, kind));
    return Boolean(pulse && pulse.seenAt <= now && now.getTime() - pulse.seenAt.getTime() < 90_000);
  } finally { await db.close(); }
}
export async function recordWorkflowWorkerHeartbeat(handler: { key: string; version: number }, databaseUrl?: string, now = new Date()) {
  const kind = workflowKind(handler), db = createDatabase(databaseUrl);
  try {
    const [exists] = await db.db.execute<{ present: boolean }>(sql`select to_regclass('public.coordinator_worker_health') is not null as present`);
    if (exists?.present) await db.db.insert(coordinatorWorkerHealth).values({ kind, seenAt: now }).onConflictDoUpdate({ target: coordinatorWorkerHealth.kind, set: { seenAt: now } });
  } finally { await db.close(); }
}

/** The durable Coordinator turn runner (A2) checks in here. Admission uses durable execution only while this is fresh. */
export async function recordCoordinatorTurnRunnerHeartbeat(databaseUrl?: string, now = new Date()) {
  const db = createDatabase(databaseUrl);
  try {
    const [exists] = await db.db.execute<{ present: boolean }>(sql`select to_regclass('public.coordinator_worker_health') is not null as present`);
    if (exists?.present) await db.db.insert(coordinatorWorkerHealth).values({ kind: "coordinator_turns", seenAt: now }).onConflictDoUpdate({ target: coordinatorWorkerHealth.kind, set: { seenAt: now } });
  } finally { await db.close(); }
}
export async function coordinatorTurnRunnerHealthy(databaseUrl?: string, now = new Date(), freshnessMs = 30_000) {
  const db = createDatabase(databaseUrl);
  try {
    const [exists] = await db.db.execute<{ present: boolean }>(sql`select to_regclass('public.coordinator_worker_health') is not null and to_regclass('public.coordinator_turn_executions') is not null as present`);
    if (!exists?.present) return false;
    const [pulse] = await db.db.select().from(coordinatorWorkerHealth).where(eq(coordinatorWorkerHealth.kind, "coordinator_turns"));
    return Boolean(pulse && pulse.seenAt <= now && now.getTime() - pulse.seenAt.getTime() < freshnessMs);
  } finally { await db.close(); }
}
