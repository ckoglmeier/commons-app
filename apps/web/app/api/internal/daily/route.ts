import { NextResponse } from "next/server";
import { pingDatabase } from "@commons/database";
import { processInvitationDelivery } from "@/lib/server/commons";
import { runCommonsMaintenance } from "@/lib/server/maintenance";
import { messagingDeps } from "@/lib/server/messaging/core";
import { runMessagingTick } from "@/lib/server/messaging/dispatch";
import { sendMessageNoticesQuietly } from "@/lib/server/messaging/notices";
import { drainPollDeliveries } from "@/lib/server/poll-delivery";
import { authorizeCommonsCronRequest, commonsDatabaseUrl } from "@/lib/server/runtime-environment";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The one scheduled job, once a day (Vercel Hobby allows daily schedules only). It keeps a free Supabase project awake, retries invitation
 * and poll emails, runs the messaging pass and sends any held message notices. Most work also happens right away on activity; this catches
 * up on anything that waited. Each step runs on its own, so one failure doesn't stop the rest. Cron-secret only.
 */
export async function GET(request: Request) {
  const authorization = authorizeCommonsCronRequest(request);
  if (!authorization.authorized) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const step = async <T,>(name: string, run: () => Promise<T>) => {
    try { return { ok: true as const, result: await run() }; }
    catch (error) { console.warn("commons.daily.step_failed", { step: name, error: error instanceof Error ? error.name : "unknown" }); return { ok: false as const }; }
  };
  const databaseUrl = commonsDatabaseUrl();
  const awake = await step("keep_awake", async () => databaseUrl ? pingDatabase(databaseUrl) : false);
  const maintenance = await step("maintenance", runCommonsMaintenance);
  const invitations = await step("invitations", async () => {
    let processed = 0;
    const deadline = Date.now() + 25_000;
    for (let index = 0; index < 100 && Date.now() < deadline; index += 1) {
      if (!await processInvitationDelivery(null, authorization.origin)) break;
      processed += 1;
    }
    return processed;
  });
  const polls = await step("poll_deliveries", () => drainPollDeliveries(authorization.origin));
  const messaging = await step("messaging", async () => runMessagingTick(await messagingDeps({ allowNoProvider: true })));
  const notices = await step("message_notices", () => sendMessageNoticesQuietly(authorization.origin));
  return NextResponse.json({ awake, maintenance, invitations, polls, messaging, notices }, { headers: { "Cache-Control": "no-store" } });
}
