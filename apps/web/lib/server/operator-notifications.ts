import "server-only";
import { after } from "next/server";
import { completeOperatorNotification, leaseOperatorNotification } from "@commons/database";
import { sendEmail } from "@/lib/email/resend";
import { commonsSiteOrigin, readCommonsRuntimeEnvironment, requireCommonsDatabaseUrl } from "./runtime-environment";
import { runOperatorNotification } from "./operator-notification-worker";

export async function processOperatorNotification(dedupeKey?: string) {
  const url = requireCommonsDatabaseUrl();
  const environment = readCommonsRuntimeEnvironment();
  return runOperatorNotification(commonsSiteOrigin(), environment.COMMONS_OPERATOR_NOTIFICATION_EMAIL, {
    lease: () => leaseOperatorNotification(url, dedupeKey),
    complete: (id, attempt, result) => completeOperatorNotification(id, attempt, result, url),
    send: sendEmail,
  });
}

export function scheduleOperatorNotification(dedupeKey: string) {
  // Source record and queue entry are committed together. Scheduling or email
  // failure must never turn a saved user submission into a misleading error.
  try {
    after(async () => {
      try { await processOperatorNotification(dedupeKey); }
      catch { console.error("Operator notification deferred to the durable retry queue."); }
    });
  } catch { console.error("Operator notification scheduling deferred to the durable retry queue."); }
}

export async function drainOperatorNotifications() {
  const results = [];
  const deadline = Date.now() + 25_000;
  for (let index = 0; index < 30 && Date.now() < deadline; index += 1) {
    const result = await processOperatorNotification();
    if (!result) break;
    results.push(result);
  }
  return results;
}
