import { claimMessageNotices, invitedEmailForPerson, messageEmailsEnabled, releaseMessageNotice, unreadWebMessageRecipients, type UnreadWebRecipient } from "@commons/database";
import { sendEmail } from "@/lib/email/resend";
import { getSupabaseAuthUserEmail, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { commonsDatabaseUrl } from "../runtime-environment";
import { isQuietHours } from "@commons/domain";
import { renderMessageNoticeEmail } from "@/lib/email/message-notice-email";
import type { SendEmailInput } from "@/lib/email/resend";

/*
 * Email notices for Messages with Commons. A message in someone's thread reaches nobody until they open Commons, so when Commons leaves
 * new messages, each person gets one short email with a link to their thread: at most one per batch and one until they read it, never
 * during their trip's quiet hours, and never when they've turned message emails off. The email carries no message text.
 */

export type NoticeDeps = {
  databaseUrl: string;
  now: () => Date;
  origin: string;
  send: (input: SendEmailInput) => Promise<unknown>;
  /** The person's email, and whether they want message emails. Null when there's no address to use. */
  recipient: (person: { personId: string; authUserId: string | null }) => Promise<{ email: string; emailsEnabled: boolean } | null>;
};

export type NoticeSummary = { candidates: number; sent: number; held: number; skipped: number; failed: number };

const LOOKBACK_MS = 3 * 24 * 3_600_000;

export async function sendMessageNotices(deps: NoticeDeps): Promise<NoticeSummary> {
  const now = deps.now();
  const summary: NoticeSummary = { candidates: 0, sent: 0, held: 0, skipped: 0, failed: 0 };
  const rows = await unreadWebMessageRecipients(new Date(now.getTime() - LOOKBACK_MS), deps.databaseUrl);
  const byPerson = new Map<string, UnreadWebRecipient[]>();
  for (const row of rows) byPerson.set(row.personId, [...(byPerson.get(row.personId) ?? []), row]);
  summary.candidates = byPerson.size;
  // Quiet hours follow the trip, as messages do. A person is held if any of their trips is in quiet hours; the next batch or the daily job sends it.
  const ready = [...byPerson.entries()].filter(([, trips]) => {
    const quiet = trips.some(trip => trip.timezone && isQuietHours(now, trip.timezone));
    if (quiet) summary.held++;
    return !quiet;
  });
  const claimed = new Set(await claimMessageNotices(ready.map(([personId]) => personId), now, deps.databaseUrl));
  for (const [personId, trips] of ready) {
    if (!claimed.has(personId)) { summary.skipped++; continue; }
    const first = trips[0]!;
    const recipient = await deps.recipient({ personId, authUserId: first.authUserId }).catch(() => null);
    if (!recipient || !recipient.emailsEnabled) { summary.skipped++; continue; }
    const email = renderMessageNoticeEmail({ recipientName: first.displayName, tripNames: trips.map(trip => trip.tripName ?? ""), threadUrl: new URL("/messages", deps.origin).toString() });
    try {
      await deps.send({ ...email, to: recipient.email, idempotencyKey: `commons-message-notice-${personId}-${now.getTime()}` });
      summary.sent++;
    } catch (error) {
      // Not sent: let the next batch try again rather than marking this person as told.
      await releaseMessageNotice(personId, null, deps.databaseUrl);
      summary.failed++;
      console.warn("commons.messaging.notice_failed", { error: error instanceof Error ? error.name : "unknown" });
    }
  }
  return summary;
}

/** Notices as the app sends them: through the configured email mode, to the account's email (or, without Supabase admin access, the address the person was invited at). */
export async function defaultNoticeDeps(origin: string): Promise<NoticeDeps | null> {
  const databaseUrl = commonsDatabaseUrl();
  if (!databaseUrl) return null;
  return {
    databaseUrl, origin, now: () => new Date(), send: sendEmail,
    recipient: async ({ personId, authUserId }) => {
      const email = authUserId && isSupabaseAdminConfigured() ? await getSupabaseAuthUserEmail(authUserId).catch(() => null) : await invitedEmailForPerson(personId, databaseUrl);
      return email ? { email, emailsEnabled: await messageEmailsEnabled(personId, databaseUrl) } : null;
    },
  };
}

/** Sends any notices due, never failing the caller: a notice is a nicety on top of the thread. */
export async function sendMessageNoticesQuietly(origin: string) {
  try {
    const deps = await defaultNoticeDeps(origin);
    return deps ? await sendMessageNotices(deps) : null;
  } catch (error) {
    console.warn("commons.messaging.notices_failed", { error: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}
