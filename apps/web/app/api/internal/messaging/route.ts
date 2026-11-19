import { messagingRoute, json } from "@/lib/server/messaging/http";
import { messagingDeps } from "@/lib/server/messaging/core";
import { runMessagingTick } from "@/lib/server/messaging/dispatch";
import { authorizeCommonsCronRequest, webMessagesEnabled } from "@/lib/server/runtime-environment";

export const dynamic = "force-dynamic";
/** The scheduled pass (reprocess stored inbound, expire questions, ask what is next, send what is due). Cron-secret only. Not scheduled in vercel.json by this change. */
export const GET = (request: Request) => messagingRoute(async () => {
  const authorization = authorizeCommonsCronRequest(request);
  if (!authorization.authorized) return json({ error: authorization.error }, authorization.status);
  // With only web messages on there is no SMS provider; the pass still runs for threads in Commons.
  return json(await runMessagingTick(await messagingDeps({ allowNoProvider: webMessagesEnabled() })));
});
