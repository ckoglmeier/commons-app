import { createHash } from "node:crypto";
import { and, eq, inArray, lt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { TurnCommand } from "@commons/contracts";
import { createDatabase } from "./client";
import { commons, memberships, coordinatorThreads, coordinatorSources, pollDrafts } from "./schema";
import { CommandAccessError, CommandConflictError } from "./event-command";
import { isCommonsId } from "./commons-identifier";
import type { PollRepositoryOptions } from "./poll-repository";

const inputSchema = z.object({ id: z.string().uuid(), scope: z.string().regex(/^(new|ask|thread:[0-9a-f-]{36}|draft:[0-9a-f-]{36})$/),
  filename: z.string().min(1).max(160), text: z.string().min(1).max(30000), limitations: z.array(z.string().max(300)).max(12) }).strict();
type Transaction = Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0];
async function scope(tx: Transaction, identifier: string, options: PollRepositoryOptions) {
  const [trip] = await tx.select().from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).for("update");
  const [member] = trip ? await tx.select().from(memberships).where(and(eq(memberships.commonsId, trip.id), eq(memberships.personId, options.actorPersonId), eq(memberships.status, "active"), eq(memberships.role, "organizer"))) : [];
  if (!member || !trip) throw new CommandAccessError();
  return trip.id;
}
async function checkDestination(tx: Transaction, tripId: string, destination: string, ownerId: string) {
  if (["new", "ask"].includes(destination)) return;
  const id = destination.slice(destination.indexOf(":") + 1);
  if (destination.startsWith("thread:")) {
    const [thread] = await tx.select().from(coordinatorThreads).where(and(eq(coordinatorThreads.id, id), eq(coordinatorThreads.commonsId, tripId), eq(coordinatorThreads.status, "active")));
    if (!thread) throw new CommandAccessError();
  } else {
    const [draft] = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.id, id), eq(pollDrafts.commonsId, tripId)));
    if (!draft || !draft.organizerShared && draft.ownerPersonId !== ownerId) throw new CommandAccessError();
  }
}
export async function authorizeCoordinatorSource(identifier: string, destination: string, options: PollRepositoryOptions) {
  inputSchema.shape.scope.parse(destination);
  const db = createDatabase(options.databaseUrl);
  try { await db.db.transaction(async tx => { const tripId = await scope(tx, identifier, options); await checkDestination(tx, tripId, destination, options.actorPersonId); }); }
  finally { await db.close(); }
}
export async function saveCoordinatorSource(identifier: string, raw: unknown, options: PollRepositoryOptions) {
  const input = inputSchema.parse(raw), db = createDatabase(options.databaseUrl);
  try { return await db.db.transaction(async tx => {
    const tripId = await scope(tx, identifier, options); await checkDestination(tx, tripId, input.scope, options.actorPersonId);
    // Opportunistic bounded retention: expired sources are unreadable even before deletion.
    await tx.delete(coordinatorSources).where(and(eq(coordinatorSources.ownerPersonId, options.actorPersonId), eq(coordinatorSources.commonsId, tripId), lt(coordinatorSources.expiresAt, new Date())));
    const digest = createHash("sha256").update(JSON.stringify([input.filename, input.text, input.limitations])).digest("hex");
    const [prior] = await tx.select().from(coordinatorSources).where(eq(coordinatorSources.id, input.id));
    if (prior) {
      if (prior.removedAt) throw new CommandAccessError();
      if (prior.ownerPersonId !== options.actorPersonId || prior.commonsId !== tripId || prior.scope !== input.scope || prior.digest !== digest) throw new CommandConflictError();
      return prior;
    }
    const existing = await tx.select({ id: coordinatorSources.id }).from(coordinatorSources).where(and(eq(coordinatorSources.ownerPersonId, options.actorPersonId), eq(coordinatorSources.commonsId, tripId), isNull(coordinatorSources.boundThreadId), isNull(coordinatorSources.removedAt)));
    if (existing.length >= 24) throw new CommandConflictError();
    const [saved] = await tx.insert(coordinatorSources).values({ id: input.id, commonsId: tripId, ownerPersonId: options.actorPersonId, scope: input.scope,
      filename: input.filename, digest, extractedText: input.text, limitations: input.limitations, expiresAt: new Date(Date.now() + 7 * 86400000) }).returning();
    return saved;
  }); } finally { await db.close(); }
}
export async function readCoordinatorSources(identifier: string, refs: NonNullable<TurnCommand["attachments"]>, options: PollRepositoryOptions, command?: TurnCommand, destination?: string) {
  const db = createDatabase(options.databaseUrl);
  try { return await db.db.transaction(async tx => {
    const tripId = await scope(tx, identifier, options);
    if (!refs.length || new Set(refs.map(ref => ref.id)).size !== refs.length) throw new CommandAccessError();
    const rows = await tx.select().from(coordinatorSources).where(and(eq(coordinatorSources.commonsId, tripId), eq(coordinatorSources.ownerPersonId, options.actorPersonId), inArray(coordinatorSources.id, refs.map(ref => ref.id)))).for("update");
    if (rows.length !== refs.length) throw new CommandAccessError();
    for (const row of rows) {
      if (row.removedAt || row.expiresAt <= new Date() || row.digest !== refs.find(ref => ref.id === row.id)?.digest) throw new CommandAccessError();
      // Binding never replaces the original draft's access boundary.
      await checkDestination(tx, tripId, row.scope, options.actorPersonId);
      if (row.boundThreadId) await checkDestination(tx, tripId, `thread:${row.boundThreadId}`, options.actorPersonId);
      if (!command) {
        if (!destination || destination !== row.scope && destination !== `thread:${row.boundThreadId}`) throw new CommandAccessError();
        continue;
      }
      const target = command.target;
      const targetId = target.kind === "new" || target.kind === "existing" ? target.threadId : null;
      if (!targetId) throw new CommandAccessError();
      if (row.boundThreadId && row.boundThreadId !== targetId) throw new CommandAccessError();
      if (row.scope.startsWith("thread:") && row.scope !== `thread:${targetId}` || row.scope.startsWith("draft:") && (command.artifact?.kind !== "draft" || row.scope !== `draft:${command.artifact.id}`)) throw new CommandAccessError();
      if (["new", "ask"].includes(row.scope) && !row.boundThreadId && target.kind !== "new") throw new CommandAccessError();
      if (!row.boundThreadId) await tx.update(coordinatorSources).set({ boundThreadId: targetId }).where(eq(coordinatorSources.id, row.id));
    }
    if (rows.map(row => `Source: ${row.filename}\n${row.extractedText}\nLimitations: ${row.limitations.join(" ")}`).join("\n\n").length > 30000) throw new CommandConflictError();
    return refs.map(ref => rows.find(row => row.id === ref.id)!);
  }); } finally { await db.close(); }
}
export async function removeCoordinatorSource(identifier: string, id: string, options: PollRepositoryOptions) {
  z.string().uuid().parse(id);
  const db = createDatabase(options.databaseUrl);
  try { await db.db.transaction(async tx => { const tripId = await scope(tx, identifier, options);
    const [row] = await tx.select().from(coordinatorSources).where(and(eq(coordinatorSources.id, id), eq(coordinatorSources.commonsId, tripId), eq(coordinatorSources.ownerPersonId, options.actorPersonId))).for("update");
    if (row?.boundThreadId) throw new CommandAccessError();
    const removedAt = new Date();
    if (row) {
      // Retain only cancellation identity, never the removed source content.
      await tx.update(coordinatorSources).set({ removedAt, extractedText: "Removed", filename: "Removed", limitations: [] }).where(and(eq(coordinatorSources.id, row.id), isNull(coordinatorSources.boundThreadId)));
    } else {
      // DELETE may arrive before the in-flight POST commits. The trip lock orders
      // both transactions; a tombstone prevents that late POST recreating a source.
      const [prior] = await tx.select().from(coordinatorSources).where(eq(coordinatorSources.id, id));
      if (prior) throw new CommandAccessError();
      await tx.insert(coordinatorSources).values({ id, commonsId: tripId, ownerPersonId: options.actorPersonId, scope: "new", filename: "Removed", extractedText: "Removed", limitations: [], digest: createHash("sha256").update(id).digest("hex"), removedAt, expiresAt: new Date(removedAt.getTime() + 7 * 86400000) });
    }
  }); } finally { await db.close(); }
}
