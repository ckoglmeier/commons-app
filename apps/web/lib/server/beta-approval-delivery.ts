import "server-only";
import { betaApprovalNoticeStillCurrent, finishBetaApprovalNotice, reserveBetaApprovalNotice } from "@commons/database";
import { sendEmail } from "@/lib/email/resend";
import { commonsSiteOrigin, readCommonsRuntimeEnvironment } from "./runtime-environment";
import { runBetaApprovalNotice } from "./beta-approval-worker";

export function betaApprovalEmailEnabled() {
  const environment = readCommonsRuntimeEnvironment();
  return environment.COMMONS_BETA_APPROVAL_EMAIL_ENABLED === "true" && (environment.COMMONS_EMAIL_SEND_MODE ?? "disabled") !== "disabled";
}

/** Off by default. While off, a prepared notice stays prepared and nothing claims it was sent. */
export async function deliverBetaApprovalNotice(personId: string, databaseUrl: string) {
  if (!betaApprovalEmailEnabled()) return "disabled";
  return runBetaApprovalNotice(commonsSiteOrigin(), {
    reserve: () => reserveBetaApprovalNotice(personId, databaseUrl),
    current: notice => betaApprovalNoticeStillCurrent(personId, notice.leaseAt, databaseUrl),
    finish: (notice, sent) => finishBetaApprovalNotice(personId, notice.leaseAt, sent, databaseUrl),
    send: sendEmail,
  });
}
