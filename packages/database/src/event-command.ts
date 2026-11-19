import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { CommonsDatabase } from "./client";
import { isCommonsId } from "./commons-identifier";
import { auditEvents, commons, memberships, people, processedCommands } from "./schema";

export type CommandTransaction = Parameters<Parameters<CommonsDatabase["db"]["transaction"]>[0]>[0];

export class CommandConflictError extends Error {
  readonly code = "command_conflict";
  constructor() {
    super("This command has already been used for a different change. Refresh before trying again.");
    this.name = "CommandConflictError";
  }
}

export class CommandAccessError extends Error {
  readonly code = "actor_not_authorized";
  constructor() { super("Only an active participant can change this trip."); this.name = "CommandAccessError"; }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}

export function commandFingerprint(actorId: string, action: string, input: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical({ actorId, action, input }))).digest("hex");
}

export async function runEventCommand<T extends Record<string, unknown>>(
  tx: CommandTransaction,
  request: { identifier: string; actorPersonId: string; commandId: string; action: string; input: unknown },
  authorize: (context: { id: string; role: "organizer" | "member"; displayName: string }) => void | Promise<void>,
  mutate: (context: { id: string; role: "organizer" | "member"; displayName: string; now: Date }) => Promise<{
    result: T; resourceType: string; resourceId: string; summary: string;
  }>,
): Promise<T> {
  const [event] = await tx.select({ id: commons.id }).from(commons)
    .where(isCommonsId(request.identifier) ? eq(commons.id, request.identifier) : eq(commons.slug, request.identifier))
    .for("update").limit(1);
  const [actor] = event ? await tx.select({ role: memberships.role, status: memberships.status, displayName: people.displayName })
    .from(memberships).innerJoin(people, eq(people.id, memberships.personId))
    .where(and(eq(memberships.commonsId, event.id), eq(memberships.personId, request.actorPersonId))).limit(1) : [];
  if (!event || !actor || actor.status !== "active") throw new CommandAccessError();
  const context = { id: event.id, role: actor.role, displayName: actor.displayName, now: new Date() };
  await authorize(context);
  const fingerprint = commandFingerprint(request.actorPersonId, request.action, request.input);
  const [previous] = await tx.select({ result: processedCommands.result }).from(processedCommands)
    .where(and(eq(processedCommands.commonsId, event.id), eq(processedCommands.commandId, request.commandId))).limit(1);
  if (previous) {
    const receipt = previous.result as { fingerprint?: string; result?: T };
    if (receipt.fingerprint !== fingerprint || !receipt.result) throw new CommandConflictError();
    return receipt.result;
  }
  // Old feature-specific commands may have only an audit record. Never apply
  // such a command again or invent a payload binding for its historical receipt.
  const [oldAudit] = await tx.select({ id: auditEvents.id }).from(auditEvents)
    .where(and(eq(auditEvents.commonsId, event.id), eq(auditEvents.commandId, request.commandId))).limit(1);
  if (oldAudit) throw new CommandConflictError();
  const change = await mutate(context);
  await tx.insert(auditEvents).values({
    commonsId: event.id, commandId: request.commandId, actorId: request.actorPersonId,
    actorType: "human", action: request.action, resourceType: change.resourceType,
    resourceId: change.resourceId, summary: change.summary, occurredAt: context.now,
  });
  await tx.insert(processedCommands).values({
    commonsId: event.id, commandId: request.commandId,
    result: { fingerprint, result: change.result },
  });
  return change.result;
}
