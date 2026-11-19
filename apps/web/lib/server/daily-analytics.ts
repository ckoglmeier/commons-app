import "server-only";
import { queueDailyAnalyticsReport } from "@commons/database";
import { processOperatorNotification } from "./operator-notifications";
import { internalAnalyticsEmails } from "../posthog-exclusions";

/** Queues a de-duplicated Denver-day report, then sends it through the durable operator outbox. */
export async function runDailyAnalyticsReport(now = new Date()) {
  const queued = await queueDailyAnalyticsReport(now, undefined, { excludedEmails: [...internalAnalyticsEmails] });
  const delivery = await processOperatorNotification(`daily-analytics:${queued.report.periodKey}`);
  return {
    periodKey: queued.report.periodKey,
    queued: Boolean(queued.deliveryId),
    delivery: !delivery ? "already_sent" : "skipped" in delivery ? "review_required" : delivery.status,
  };
}
