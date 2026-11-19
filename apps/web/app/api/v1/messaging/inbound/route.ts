import { messagingRoute } from "@/lib/server/messaging/http";
import { receiveInbound } from "@/lib/server/messaging/webhooks";

export const dynamic = "force-dynamic";
/** Provider webhook for inbound texts. Signature-verified and deduplicated. */
export const POST = (request: Request) => messagingRoute(() => receiveInbound(request));
