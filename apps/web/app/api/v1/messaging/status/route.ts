import { messagingRoute } from "@/lib/server/messaging/http";
import { receiveStatus } from "@/lib/server/messaging/webhooks";

export const dynamic = "force-dynamic";
/** Provider webhook for delivery receipts. Signature-verified and deduplicated by the provider's event key. */
export const POST = (request: Request) => messagingRoute(() => receiveStatus(request));
