import { json, messagingRoute } from "@/lib/server/messaging/http";
import { checkTestThread, readTestThread, sendTestThreadMessage } from "@/lib/server/messaging/test-thread";
import { createTestTrip } from "@/lib/server/messaging/test-trip";

export const dynamic = "force-dynamic";

/** The signed-in tester's own thread. Everyone else gets a plain not-found. */
export const GET = () => messagingRoute(async () => json(await readTestThread()));
/** Send a reply, with `{ "check": true }` ask for whatever is due now, or with `{ "testTrip": true }` start a fresh test trip with texts on. */
export const POST = (request: Request) => messagingRoute(async () => {
  const body = await request.json() as { check?: boolean; testTrip?: boolean };
  if (body?.testTrip === true) await createTestTrip();
  else if (body?.check === true) await checkTestThread(); else await sendTestThreadMessage(body);
  return json(await readTestThread());
});
