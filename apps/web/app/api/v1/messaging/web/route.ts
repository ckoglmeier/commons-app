import { json, messagingRoute } from "@/lib/server/messaging/http";
import { readWebThread, sendWebThreadMessage } from "@/lib/server/messaging/web-thread";

export const dynamic = "force-dynamic";

/** The signed-in person's own thread with Commons. Anyone without web messages gets a plain not-found. */
export const GET = () => messagingRoute(async () => json(await readWebThread()));
/** Send a message to Commons: `{ id, body }`. Returns the updated thread. */
export const POST = (request: Request) => messagingRoute(async () => {
  await sendWebThreadMessage(await request.json());
  return json(await readWebThread());
});
