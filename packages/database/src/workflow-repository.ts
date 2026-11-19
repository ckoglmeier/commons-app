import { ActivateWorkflowVersionSchema, SaveWorkflowVersionSchema, WorkflowKeySchema, WorkflowReferenceSchema, WorkflowTemplateSchema, type WorkflowReference, type WorkflowTemplate } from "@commons/contracts";
import { and, desc, eq, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { commandFingerprint, CommandConflictError, type CommandTransaction } from "./event-command";
import { workflowTemplates } from "./schema";
import { assertWorkflowRecipePin } from "./workflow-recipe-pin";

function dto(row: typeof workflowTemplates.$inferSelect): WorkflowTemplate {
  return WorkflowTemplateSchema.parse({ id: row.id, key: row.key, version: row.version, title: row.title, description: row.description,
    purpose: row.purpose, instructions: row.instructions, status: row.status, createdAt: row.createdAt.toISOString() });
}
function throwWorkflowWriteError(error: unknown): never {
  // A command id reused concurrently across different keys races the global
  // receipt index rather than a key lock. It is a conflict, not a retryable 500.
  let cause = error;
  for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth++) {
    if ("code" in cause && cause.code === "23505") throw new CommandConflictError();
    cause = "cause" in cause ? cause.cause : null;
  }
  throw error;
}
export async function listWorkflowTemplates(databaseUrl: string) {
  const db = createDatabase(databaseUrl);
  try { return (await db.db.select().from(workflowTemplates).orderBy(workflowTemplates.key, desc(workflowTemplates.version))).map(dto); }
  finally { await db.close(); }
}
export async function resolveWorkflowTemplate(key: string, reference: WorkflowReference | undefined, databaseUrl: string) {
  WorkflowKeySchema.parse(key);
  const db = createDatabase(databaseUrl);
  try { return await resolveWorkflowTemplateInTransaction(db.db, key, reference); }
  finally { await db.close(); }
}
export async function resolveWorkflowTemplateInTransaction(tx: Pick<CommandTransaction, "select">, key: string, reference?: WorkflowReference) {
  if (reference) { WorkflowReferenceSchema.parse(reference); if (key !== reference.key) throw new CommandConflictError(); }
  const [row] = await tx.select().from(workflowTemplates).where(reference
    ? and(eq(workflowTemplates.id, reference.id), eq(workflowTemplates.key, reference.key), eq(workflowTemplates.version, reference.version))
    : and(eq(workflowTemplates.key, key), eq(workflowTemplates.status, "active"))).limit(1);
  // Retired versions remain valid for pinned drafts. An unactivated recipe cannot run.
  if (!row || row.status === "draft") throw new CommandConflictError();
  const template = dto(row);
  if (reference) assertWorkflowRecipePin(template, reference);
  return template;
}

/** Server-internal operation: every HTTP entry must first verify the operator allowlist. */
export async function saveWorkflowVersion(raw: unknown, operatorId: string, databaseUrl: string) {
  const input = SaveWorkflowVersionSchema.parse(raw), db = createDatabase(databaseUrl);
  const fingerprint = commandFingerprint(operatorId, "workflow.version", input);
  try { return await db.db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.definition.key}))`);
    const [replay] = await tx.select().from(workflowTemplates).where(eq(workflowTemplates.saveCommandId, input.commandId));
    if (replay) { if (replay.saveFingerprint !== fingerprint) throw new CommandConflictError(); return dto(replay); }
    const [latest] = await tx.select().from(workflowTemplates).where(eq(workflowTemplates.key, input.definition.key)).orderBy(desc(workflowTemplates.version)).limit(1);
    if ((latest?.version ?? 0) !== input.expectedLatestVersion) throw new CommandConflictError();
    // Changing handler family requires a new logical workflow, not rewriting a pinned recipe.
    if (latest && latest.purpose !== input.definition.purpose) throw new CommandConflictError();
    const [saved] = await tx.insert(workflowTemplates).values({ ...input.definition, version: (latest?.version ?? 0) + 1,
      status: "draft", authoredBy: operatorId, saveCommandId: input.commandId, saveFingerprint: fingerprint }).returning();
    return dto(saved);
  }); } catch (error) { throwWorkflowWriteError(error); } finally { await db.close(); }
}
export async function activateWorkflowVersion(raw: unknown, operatorId: string, databaseUrl: string) {
  const input = ActivateWorkflowVersionSchema.parse(raw), db = createDatabase(databaseUrl);
  const fingerprint = commandFingerprint(operatorId, "workflow.activate", input);
  try { return await db.db.transaction(async tx => {
    const [candidate] = await tx.select().from(workflowTemplates).where(eq(workflowTemplates.id, input.id));
    if (!candidate) throw new CommandConflictError();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${candidate.key}))`);
    const [replay] = await tx.select().from(workflowTemplates).where(eq(workflowTemplates.activationCommandId, input.commandId));
    if (replay) { if (replay.activationFingerprint !== fingerprint) throw new CommandConflictError(); return dto(replay); }
    const versions = await tx.select().from(workflowTemplates).where(eq(workflowTemplates.key, candidate.key)).orderBy(desc(workflowTemplates.version)).for("update");
    const current = versions.find(row => row.status === "active"), chosen = versions.find(row => row.id === candidate.id);
    if ((current?.id ?? null) !== input.expectedActiveId || chosen?.status !== "draft" || versions[0].id !== chosen.id) throw new CommandConflictError();
    if (current) await tx.update(workflowTemplates).set({ status: "retired" }).where(eq(workflowTemplates.id, current.id));
    const [saved] = await tx.update(workflowTemplates).set({ status: "active", activationCommandId: input.commandId, activationFingerprint: fingerprint }).where(eq(workflowTemplates.id, chosen.id)).returning();
    return dto(saved);
  }); } catch (error) { throwWorkflowWriteError(error); } finally { await db.close(); }
}
