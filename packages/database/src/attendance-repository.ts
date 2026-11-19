import { EventAttendanceSchema, SetEventAttendanceSchema, eventAttendanceDates } from "@commons/contracts";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { createDatabase } from "./client";
import { isCommonsId } from "./commons-identifier";
import { CommandAccessError, CommandConflictError, commandFingerprint, runEventCommand } from "./event-command";
import { commons, invitationDeliveryAttempts, invitations, memberships, people, processedCommands } from "./schema";
import { revokedOpaqueTokenHash } from "./tokens";

type Options = { databaseUrl?: string; actorPersonId: string };
const identifierCondition = (identifier: string) => isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier);

export class AttendanceReviewError extends Error {
  readonly code = "attendance_review_required";
}

export async function getEventAttendance(identifier: string, options: Options) {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [event] = await tx.select({ id: commons.id, startsOn: commons.startsOn, endsOn: commons.endsOn })
        .from(commons).where(identifierCondition(identifier)).for("share").limit(1);
      if (!event) throw new CommandAccessError();
      const [actor] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, event.id), eq(memberships.personId, options.actorPersonId)));
      if (actor?.status !== "active") throw new CommandAccessError();
      const dates = eventAttendanceDates(event.startsOn, event.endsOn);
      const rows = await tx.select({ personId: people.id, displayName: people.displayName, state: memberships.attendanceState,
        reviewedDates: memberships.attendanceDates, status: memberships.status }).from(memberships)
        .innerJoin(people, eq(people.id, memberships.personId)).where(eq(memberships.commonsId, event.id));
      return EventAttendanceSchema.parse({ ...event, dates, currentPersonId: options.actorPersonId,
        people: rows.filter(row => row.status === "active" || row.state === "declined").map(row => ({ ...row,
          state: row.state === "attending" && row.reviewedDates !== dates ? "needs_confirmation" : row.state,
        })),
      });
    });
  } finally { await database.close(); }
}

export async function setEventAttendance(identifier: string, rawInput: unknown, options: Options) {
  const input = SetEventAttendanceSchema.parse(rawInput);
  const database = createDatabase(options.databaseUrl);
  const action = "membership.attendance_updated";
  try {
    return await database.db.transaction(async tx => {
      const [event] = await tx.select().from(commons).where(identifierCondition(identifier)).for("update").limit(1);
      if (!event) throw new CommandAccessError();
      const [actor] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, event.id), eq(memberships.personId, options.actorPersonId)));
      // A declined actor can retry only the exact completed command. No event data
      // is returned and no mutation or access restoration is possible here.
      if (actor?.status === "left" && actor.attendanceState === "declined" && input.state === "declined") {
        const [previous] = await tx.select().from(processedCommands).where(and(eq(processedCommands.commonsId, event.id), eq(processedCommands.commandId, input.commandId)));
        const receipt = previous?.result as { fingerprint?: string } | undefined;
        if (receipt?.fingerprint === commandFingerprint(options.actorPersonId, action, input)) return { state: "declined" as const };
        throw new CommandAccessError();
      }
      return runEventCommand(tx, { identifier, actorPersonId: options.actorPersonId, commandId: input.commandId, action, input },
        async context => {
          // Retry already-completed commands before demanding a new date review.
          const [previous] = await tx.select().from(processedCommands).where(and(eq(processedCommands.commonsId, event.id), eq(processedCommands.commandId, input.commandId)));
          if (previous) {
            if ((previous.result as { fingerprint?: string }).fingerprint !== commandFingerprint(options.actorPersonId, action, input)) throw new CommandConflictError();
            return;
          }
          if (input.reviewedDates !== eventAttendanceDates(event.startsOn, event.endsOn)) throw new AttendanceReviewError("The event dates changed. Review them before answering.");
          if (input.state === "attending" && (!event.startsOn || !event.endsOn)) throw new AttendanceReviewError("Set the event dates before confirming attendance.");
          if (input.state === "declined" && context.role === "organizer") {
            const [other] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.commonsId, event.id), eq(memberships.status, "active"), eq(memberships.role, "organizer"), ne(memberships.personId, options.actorPersonId))).limit(1);
            if (!other) throw new AttendanceReviewError("Add another organizer before leaving this event.");
          }
        }, async context => {
          await tx.update(memberships).set({ attendanceState: input.state, attendanceDates: input.reviewedDates,
            ...(input.state === "declined" ? { status: "left" as const } : {}), updatedAt: context.now,
          }).where(and(eq(memberships.commonsId, event.id), eq(memberships.personId, options.actorPersonId)));
          if (input.state === "declined") {
            const oldInvites = await tx.select({ id: invitations.id, version: invitations.tokenVersion }).from(invitations)
              .where(and(eq(invitations.commonsId, event.id), or(eq(invitations.provisionalPersonId, options.actorPersonId), eq(invitations.acceptedByPersonId, options.actorPersonId))));
            for (const invitation of oldInvites) await tx.update(invitations).set({ status: "revoked", tokenHash: revokedOpaqueTokenHash(), tokenValue: null,
              tokenVersion: invitation.version + 1, updatedAt: context.now }).where(eq(invitations.id, invitation.id));
            if (oldInvites.length) await tx.update(invitationDeliveryAttempts).set({ status: "cancelled", updatedAt: context.now })
              .where(and(inArray(invitationDeliveryAttempts.invitationId, oldInvites.map(row => row.id)), inArray(invitationDeliveryAttempts.status, ["queued", "processing"])));
          }
          return { result: { state: input.state }, resourceType: "membership", resourceId: actor!.id,
            summary: input.state === "declined" ? `${context.displayName} declined the event.` : input.state === "attending" ? `${context.displayName} confirmed attendance for the current dates.` : `${context.displayName} is helping plan; attendance is not confirmed.` };
        });
    });
  } finally { await database.close(); }
}
