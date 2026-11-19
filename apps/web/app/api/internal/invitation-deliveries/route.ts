import { NextResponse } from "next/server";
import { processInvitationDelivery } from "@/lib/server/commons";
import { authorizeCommonsCronRequest } from "@/lib/server/runtime-environment";
import { runCommonsMaintenance } from "@/lib/server/maintenance";
import { drainPollDeliveries } from "@/lib/server/poll-delivery";
import { drainOperatorNotifications } from "@/lib/server/operator-notifications";

export const maxDuration = 60;

export async function GET(request: Request) {
  const authorization = authorizeCommonsCronRequest(request);
  if (!authorization.authorized) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  const maintenance = await runCommonsMaintenance();
  const [deliveries, pollDeliveries, operatorNotifications] = await Promise.all([
    (async () => {
      const results = [];
      const deadline = Date.now() + 30_000;
      for (let index = 0; index < 100 && Date.now() < deadline; index += 1) {
        const delivery = await processInvitationDelivery(null, authorization.origin);
        if (!delivery) break;
        results.push(delivery);
      }
      return results;
    })(),
    drainPollDeliveries(authorization.origin),
    drainOperatorNotifications(),
  ]);
  return NextResponse.json({ processed: deliveries.length, deliveries, pollDeliveries, operatorNotifications, maintenance });
}
