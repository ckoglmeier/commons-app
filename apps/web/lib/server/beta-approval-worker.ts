import { renderBetaApprovalEmail } from "../email/beta-approval-email";
import type { SendEmailInput } from "../email/resend";

type Notice = { personId: string; email: string; resumeDraftId: string | null; decidedAt: string; leaseAt: string };
type Dependencies = {
  reserve: () => Promise<Notice | null>;
  current: (notice: Notice) => Promise<boolean>;
  finish: (notice: Notice, sent: boolean) => Promise<boolean>;
  send: (email: SendEmailInput) => Promise<{ id: string }>;
};

/** Delivery is separate from the approval decision: a failed send never undoes it, and queued is never sent. */
export async function runBetaApprovalNotice(origin: string, dependencies: Dependencies) {
  const notice = await dependencies.reserve();
  if (!notice) return "skipped";
  try {
    if (!await dependencies.current(notice)) return "superseded";
    await dependencies.send({ ...renderBetaApprovalEmail(origin, notice.resumeDraftId), to: notice.email, idempotencyKey: `commons-beta-approval-${notice.personId}-${notice.decidedAt}` });
    return await dependencies.finish(notice, true) ? "sent" : "superseded";
  } catch {
    await dependencies.finish(notice, false).catch(() => undefined);
    return "retry_pending";
  }
}
