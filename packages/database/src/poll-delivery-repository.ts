import { and, desc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { createDatabase } from "./client";
import { commandFingerprint, runEventCommand, type CommandTransaction } from "./event-command";
import { PollRepositoryError, type PollRepositoryOptions } from "./poll-repository";
import { commons, identities, invitations, memberships, people, pollDeliveries, pollDrafts, polls } from "./schema";
import { PollAudienceSchema, PollCommunicationSchema, type PollAudience } from "@commons/contracts";
import { isCommonsId } from "./commons-identifier";
import { hashNormalizedEmail } from "./tokens";
import { assertTripMayInvite, audienceReachesOutsiders, readTripInviteGate } from "./trip-activation-repository";

type VerifiedEmailResolver = PollRepositoryOptions["resolveVerifiedEmail"];
export async function resolvePollRecipients(tx: Pick<CommandTransaction, "select">, poll: { commonsId: string; audience: PollAudience | null }, resolveVerifiedEmail?: VerifiedEmailResolver) {
  if (!poll.audience) return [];
  const result: Array<{ email: string; personId: string | null }> = [];
  for (const email of poll.audience.guestEmails) {
    const [departed] = await tx.select({ id: memberships.id }).from(identities)
      .innerJoin(memberships, and(eq(memberships.personId, identities.personId), eq(memberships.commonsId, poll.commonsId)))
      .where(and(eq(identities.kind, "email"), eq(identities.state, "claimed"), eq(identities.normalizedHash, hashNormalizedEmail(email)), inArray(memberships.status, ["left", "removed"])));
    if (!departed) result.push({ email, personId: null });
  }
  for (const personId of poll.audience.personIds) {
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, poll.commonsId), eq(memberships.personId, personId)));
    if (!member || !["active", "invited"].includes(member.status)) continue;
    if (member.status === "active" && resolveVerifiedEmail) {
      const [person] = await tx.select({ authUserId: people.authUserId }).from(people).where(eq(people.id, personId));
      if (person?.authUserId) {
        const address = await resolveVerifiedEmail(person.authUserId);
        const email = address?.trim().toLowerCase();
        if (email && z.string().email().safeParse(email).success) {
          const [claimed] = await tx.select({ id: identities.id }).from(identities).where(and(eq(identities.personId, personId), eq(identities.kind, "email"), eq(identities.state, "claimed"), eq(identities.normalizedHash, hashNormalizedEmail(email))));
          if (claimed) result.push({ email, personId });
        }
        // Auth is authoritative for signed-in members; never fall back to a stale invitation.
        continue;
      }
    }
    const candidates = await tx.select({ email: invitations.recipientEmail, status: invitations.status, expiresAt: invitations.expiresAt }).from(invitations)
      .where(and(eq(invitations.commonsId, poll.commonsId), eq(invitations.provisionalPersonId, personId), inArray(invitations.status, ["pending", "accepted"])))
      .orderBy(desc(invitations.updatedAt));
    for (const candidate of candidates) {
      if (!candidate.email || (candidate.status === "pending" && candidate.expiresAt && candidate.expiresAt <= new Date())) continue;
      const email = candidate.email.trim().toLowerCase();
      const [verified] = await tx.select({ id: identities.id }).from(identities).where(and(eq(identities.personId, personId), eq(identities.kind, "email"), eq(identities.state, "claimed"), eq(identities.normalizedHash, hashNormalizedEmail(email))));
      if ((member.status === "invited" && candidate.status === "pending") || verified) { result.push({ email, personId }); break; }
    }
  }
  return [...new Map(result.map(row => [row.email, row])).values()].sort((a, b) => a.email.localeCompare(b.email));
}
const recipients = resolvePollRecipients;
function deliveryAudienceFor(access: PollAudience | null, selected?: PollAudience): PollAudience | null {
  if (access && selected && (selected.personIds.some(id => !access.personIds.includes(id)) || selected.guestEmails.some(email => !access.guestEmails.includes(email)))) throw new PollRepositoryError("invalid_response", "Sharing cannot grant access. Choose existing poll invitees.");
  return selected ?? access;
}

/** Only the shared message from a published, immutable draft may leave this boundary. */
export async function publishedPollCommunication(tx: Pick<CommandTransaction, "select">, pollId: string) {
  const [row] = await tx.select({ data: pollDrafts.data }).from(pollDrafts).where(eq(pollDrafts.publishedPollId, pollId)).limit(1);
  return row?.data.communication ? PollCommunicationSchema.parse(row.data.communication) : null;
}
export async function publishedPollCommunicationMode(tx: Pick<CommandTransaction, "select">, pollId: string) {
  const [row] = await tx.select({ data: pollDrafts.data }).from(pollDrafts).where(eq(pollDrafts.publishedPollId, pollId)).limit(1);
  return row?.data.presentationVersion === 2 ? "separated" as const : "legacy" as const;
}
export async function publishedPollReplacement(tx: Pick<CommandTransaction, "select">, pollId: string) {
  const [original] = await tx.select({ data: pollDrafts.data }).from(pollDrafts).where(eq(pollDrafts.publishedPollId, pollId));
  const replacementId = original?.data.lifecycle?.replacementDraftId;
  if (!replacementId) return null;
  const [replacement] = await tx.select({ publicId: polls.publicId }).from(pollDrafts).innerJoin(polls, eq(polls.id, pollDrafts.publishedPollId)).where(eq(pollDrafts.id, replacementId));
  return { replacementPublicId: replacement?.publicId ?? null };
}

async function manageable(tx: Pick<CommandTransaction, "select">, slug: string, pollId: string, actorId: string) {
  const [poll] = await tx.select({ poll: polls, role: memberships.role, memberStatus: memberships.status }).from(polls)
    .innerJoin(commons, eq(commons.id, polls.commonsId))
    .innerJoin(memberships, and(eq(memberships.commonsId, commons.id), eq(memberships.personId, actorId)))
    .where(and(isCommonsId(slug) ? eq(commons.id, slug) : eq(commons.slug, slug), eq(polls.id, pollId)));
  if (!poll || poll.memberStatus !== "active" || (poll.role !== "organizer" && poll.poll.createdByPersonId !== actorId)) throw new PollRepositoryError("actor_not_authorized", "Only the poll creator or an organizer can review delivery.");
  return poll.poll;
}

export async function getPollDeliveryReview(slug: string, pollId: string, options: PollRepositoryOptions, rawAudience?: unknown) {
  const audience = rawAudience === undefined ? undefined : PollAudienceSchema.parse(rawAudience);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const poll = await manageable(tx, slug, pollId, options.actorPersonId);
      const deliveryAudience = deliveryAudienceFor(poll.audience, audience);
      const selected = await recipients(tx, { ...poll, audience: deliveryAudience }, options.resolveVerifiedEmail);
      const deliveries = await tx.select({ email: pollDeliveries.recipientEmail, status: pollDeliveries.status, errorCode: pollDeliveries.errorCode, attempts: pollDeliveries.attempts, createdAt: pollDeliveries.createdAt }).from(pollDeliveries).where(eq(pollDeliveries.pollId, pollId));
      return { fingerprint: commandFingerprint("", "poll_delivery", { audience: deliveryAudience, selected }),
        recipients: selected.map(row => {
          const delivery = deliveries.find(item => item.email === row.email);
          const exhausted = delivery?.status === "failed" && (delivery.attempts >= 3 || Date.now() - delivery.createdAt.getTime() >= 23 * 60 * 60 * 1000);
          return { ...row, status: delivery?.status ?? "not_sent", errorCode: exhausted ? "operator_review_required" : delivery?.errorCode ?? null };
        }),
        missingPersonIds: deliveryAudience?.personIds.filter(id => !selected.some(row => row.personId === id)) ?? [],
        missingEmails: deliveryAudience?.guestEmails.filter(email => !selected.some(row => row.email === email)) ?? [],
      };
    }, { isolationLevel: "repeatable read" });
  } finally { await database.close(); }
}

export async function queuePollDeliveries(slug: string, pollId: string, rawInput: unknown, options: PollRepositoryOptions) {
  const input = z.object({ commandId: z.string().uuid(), fingerprint: z.string().length(64), approved: z.literal(true), audience: PollAudienceSchema.optional() }).parse(rawInput);
  const database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(tx => runEventCommand(tx, { identifier: slug, actorPersonId: options.actorPersonId, commandId: input.commandId, action: "poll.delivery_requested", input: { pollId, ...input } },
      async () => { await manageable(tx, slug, pollId, options.actorPersonId); }, async context => {
        const poll = await manageable(tx, slug, pollId, options.actorPersonId);
        const deliveryAudience = deliveryAudienceFor(poll.audience, input.audience);
        if (await audienceReachesOutsiders(tx, context.id, deliveryAudience)) await assertTripMayInvite(tx, context.id);
        if (poll.status !== "open" || !deliveryAudience) throw new PollRepositoryError("invalid_response", "Choose recipients for an open poll before sending.");
        const selected = await recipients(tx, { ...poll, audience: deliveryAudience }, options.resolveVerifiedEmail);
        // Explicit selections must all resolve. Legacy delivery approves the resolved
        // list displayed alongside its missing-address notice, not every access holder.
        if (!selected.length || (input.audience && (deliveryAudience.personIds.some(id => !selected.some(row => row.personId === id)) || deliveryAudience.guestEmails.some(email => !selected.some(row => row.email === email))))) throw new PollRepositoryError("invalid_response", "Some recipients are no longer eligible. Review them again.");
        if (commandFingerprint("", "poll_delivery", { audience: deliveryAudience, selected }) !== input.fingerprint) throw new PollRepositoryError("invalid_response", "Recipients changed. Reload and review delivery again.");
        for (const recipient of selected) {
          const [existing] = await tx.select().from(pollDeliveries).where(and(eq(pollDeliveries.pollId, pollId), eq(pollDeliveries.recipientEmail, recipient.email)));
          if (!existing) await tx.insert(pollDeliveries).values({ pollId, recipientEmail: recipient.email, personId: recipient.personId });
          else if (existing.status === "failed" && existing.attempts < 3 && context.now.getTime() - existing.createdAt.getTime() < 23 * 60 * 60 * 1000) {
            await tx.update(pollDeliveries).set({ status: "queued", errorCode: null, availableAt: context.now, updatedAt: context.now }).where(eq(pollDeliveries.id, existing.id));
          }
        }
        return { result: { pollId }, resourceType: "poll", resourceId: pollId, summary: "Requested delivery of a reviewed poll link. No responses or private notes were included." };
      }));
    return getPollDeliveryReview(slug, pollId, options, input.audience);
  } finally { await database.close(); }
}

async function stillEligible(tx: Pick<CommandTransaction, "select">, delivery: typeof pollDeliveries.$inferSelect, resolveVerifiedEmail?: VerifiedEmailResolver) {
  const [poll] = await tx.select().from(polls).where(eq(polls.id, delivery.pollId));
  if (!poll || poll.status !== "open") return null;
  const [activeRecipient] = delivery.personId ? await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.commonsId, poll.commonsId), eq(memberships.personId, delivery.personId), eq(memberships.status, "active"))) : [];
  if (!activeRecipient && !(await readTripInviteGate(tx, poll.commonsId)).mayInvite) return null;
  if (delivery.personId) {
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, poll.commonsId), eq(memberships.personId, delivery.personId)));
    if (!member || !["active", "invited"].includes(member.status)) return null;
  }
  // Public polls retain public access; approved delivery rows record the chosen recipients.
  const audience = poll.audience
    ? { personIds: poll.audience.personIds.filter(id => id === delivery.personId), guestEmails: poll.audience.guestEmails.filter(email => !delivery.personId && email === delivery.recipientEmail) }
    : (delivery.personId ? { personIds: [delivery.personId], guestEmails: [] } : { personIds: [], guestEmails: [delivery.recipientEmail] });
  return (await recipients(tx, { ...poll, audience }, resolveVerifiedEmail)).some(row => row.email === delivery.recipientEmail && row.personId === delivery.personId) ? poll : null;
}

export async function leasePollDelivery(databaseUrl?: string, pollId?: string, resolveVerifiedEmail?: VerifiedEmailResolver) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const now = new Date();
      const [row] = await tx.select().from(pollDeliveries).where(and(pollId ? eq(pollDeliveries.pollId, pollId) : undefined, or(
        and(eq(pollDeliveries.status, "queued"), lte(pollDeliveries.availableAt, now)),
        and(eq(pollDeliveries.status, "processing"), lt(pollDeliveries.leaseExpiresAt, now)),
      ))).orderBy(pollDeliveries.createdAt).for("update", { skipLocked: true }).limit(1);
      if (!row) return null;
      if (row.attempts >= 3 || now.getTime() - row.createdAt.getTime() >= 23 * 60 * 60 * 1000) {
        await tx.update(pollDeliveries).set({ status: "failed", errorCode: "operator_review_required", updatedAt: now }).where(eq(pollDeliveries.id, row.id));
        return { skipped: true as const };
      }
      const poll = await stillEligible(tx, row, resolveVerifiedEmail);
      if (!poll) { await tx.update(pollDeliveries).set({ status: "cancelled", errorCode: "access_changed", updatedAt: now }).where(eq(pollDeliveries.id, row.id)); return { skipped: true as const }; }
      const attempt = row.attempts + 1;
      await tx.update(pollDeliveries).set({ status: "processing", attempts: attempt, leaseExpiresAt: new Date(now.getTime() + 60_000), updatedAt: now }).where(eq(pollDeliveries.id, row.id));
      return { skipped: false as const, id: row.id, attempt, email: row.recipientEmail, publicId: poll.publicId,
        content: { title: poll.title, intro: poll.intro, questions: poll.questions, communication: await publishedPollCommunication(tx, poll.id), communicationMode: await publishedPollCommunicationMode(tx, poll.id) } };
    });
  } finally { await database.close(); }
}

export async function revalidatePollDelivery(id: string, attempt: number, databaseUrl?: string, resolveVerifiedEmail?: VerifiedEmailResolver) {
  const database = createDatabase(databaseUrl);
  try {
    const [row] = await database.db.select().from(pollDeliveries).where(and(eq(pollDeliveries.id, id), eq(pollDeliveries.status, "processing"), eq(pollDeliveries.attempts, attempt)));
    return Boolean(row && row.leaseExpiresAt && row.leaseExpiresAt > new Date() && await stillEligible(database.db, row, resolveVerifiedEmail));
  } finally { await database.close(); }
}

export async function completePollDelivery(id: string, attempt: number, result: { sent: boolean; providerMessageId?: string; errorCode?: string }, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    const updated = await database.db.update(pollDeliveries).set({ status: result.sent ? "sent" : result.errorCode === "access_changed" ? "cancelled" : "failed", providerMessageId: result.providerMessageId ?? null,
      errorCode: result.errorCode ?? null, leaseExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(pollDeliveries.id, id), eq(pollDeliveries.attempts, attempt), eq(pollDeliveries.status, "processing"), sql`${pollDeliveries.leaseExpiresAt} > now()`)).returning({ id: pollDeliveries.id });
    return updated.length === 1;
  } finally { await database.close(); }
}
