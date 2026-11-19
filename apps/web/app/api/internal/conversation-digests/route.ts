import { NextResponse } from "next/server";
import {
  processConversationDigest,
  queueDailyConversationDigests,
} from "@/lib/server/conversation-digests";
import { authorizeCommonsCronRequest, readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";

export async function GET(request: Request) {
  const authorization = authorizeCommonsCronRequest(request);
  if (!authorization.authorized) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }
  if (readCommonsRuntimeEnvironment().COMMONS_CONVERSATION_DIGESTS_ENABLED !== "true") {
    return NextResponse.json({ enabled: false, queued: 0, processed: 0, deliveries: [] });
  }

  const queued = await queueDailyConversationDigests();
  const deliveries = [];
  for (let index = 0; index < 100; index += 1) {
    const delivery = await processConversationDigest(authorization.origin);
    if (!delivery) break;
    deliveries.push(delivery);
  }
  return NextResponse.json({ queued: queued.queued, processed: deliveries.length, deliveries });
}
