import { renderPollEmail } from "../email/poll-email";
import { EmailDeliveryError, type SendEmailInput } from "../email/resend";
import type { PollEmailContent } from "../email/poll-email";

type Job = { skipped: true } | { skipped: false; id: string; attempt: number; email: string; publicId: string; content?: PollEmailContent | null };
type Dependencies = {
  lease: () => Promise<Job | null>;
  revalidate: (id: string, attempt: number) => Promise<boolean>;
  complete: (id: string, attempt: number, result: { sent: boolean; providerMessageId?: string; errorCode?: string }) => Promise<boolean>;
  send: (input: SendEmailInput) => Promise<{ id: string }>;
};

export async function runPollDelivery(origin: string, dependencies: Dependencies) {
  const job = await dependencies.lease();
  if (!job || job.skipped) return job;
  try {
    const email = renderPollEmail(origin, job.publicId, job.content);
    if (!await dependencies.revalidate(job.id, job.attempt)) {
      const saved = await dependencies.complete(job.id, job.attempt, { sent: false, errorCode: "access_changed" });
      return { id: job.id, status: saved ? "cancelled" : "lease_changed" };
    }
    const sent = await dependencies.send({ ...email, to: job.email, idempotencyKey: `commons-poll-${job.id}` });
    const saved = await dependencies.complete(job.id, job.attempt, { sent: true, providerMessageId: sent.id });
    return { id: job.id, status: saved ? "sent" : "lease_changed" };
  } catch (error) {
    // Never return provider bodies, email addresses, prompts, or notes.
    const saved = await dependencies.complete(job.id, job.attempt, { sent: false, errorCode: error instanceof EmailDeliveryError ? error.code : "provider_unavailable" });
    return { id: job.id, status: saved ? "failed" : "lease_changed" };
  }
}
