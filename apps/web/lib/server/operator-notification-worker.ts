import type { OperatorNotificationPayload } from "@commons/database/schema";
import { EmailDeliveryError, type SendEmailInput } from "../email/resend";
import { renderOperatorNotificationEmail } from "../email/operator-notification-email";

type Job = { skipped: true; id: string } | { skipped: false; id: string; attempt: number; payload: OperatorNotificationPayload };
type Dependencies = {
  lease: () => Promise<Job | null>;
  complete: (id: string, attempt: number, result: { sent: boolean; providerMessageId?: string; errorCode?: string }) => Promise<boolean>;
  send: (input: SendEmailInput) => Promise<{ id: string }>;
};

export async function runOperatorNotification(origin: string, recipient: string, dependencies: Dependencies) {
  const job = await dependencies.lease();
  if (!job || job.skipped) return job;
  try {
    const rendered = renderOperatorNotificationEmail(job.payload, origin);
    const sent = await dependencies.send({ ...rendered, to: recipient, idempotencyKey: `commons-operator-${job.id}` });
    const saved = await dependencies.complete(job.id, job.attempt, { sent: true, providerMessageId: sent.id });
    return { id: job.id, status: saved ? "sent" : "lease_changed" };
  } catch (error) {
    // Log/return only bounded classifications, never support messages, emails,
    // credentials, or raw provider responses.
    const saved = await dependencies.complete(job.id, job.attempt, {
      sent: false, errorCode: error instanceof EmailDeliveryError ? error.code : "provider_unavailable",
    });
    return { id: job.id, status: saved ? "retry_queued" : "lease_changed" };
  }
}
