import { json, messagingRoute } from "@/lib/server/messaging/http";
import { readWebMessagesForTrip, setWebMessagesForTrip, shareWithTravelers } from "@/lib/server/messaging/web-thread";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ slug: string }> };

/** Where the signed-in person's messages for this trip go, the consent wording, and whether they may share as an organizer. */
export const GET = (_request: Request, { params }: Context) => messagingRoute(async () => json(await readWebMessagesForTrip((await params).slug)));
/**
 * `{ "on": true | false }` turns messages in Commons on or off for this trip. `{ "share": { id, body } }` posts an organizer's message into every
 * enrolled traveler's thread.
 */
export const POST = (request: Request, { params }: Context) => messagingRoute(async () => {
  const slug = (await params).slug, body = await request.json() as { on?: unknown; share?: unknown };
  if (body?.share !== undefined) {
    const result = await shareWithTravelers(slug, body.share);
    return result.ok ? json(result) : json({ error: { code: result.code, message: result.message } }, result.code === "organizer_only" ? 403 : 409);
  }
  if (typeof body?.on !== "boolean") return json({ error: { code: "invalid", message: "Check the details and try again." } }, 400);
  const result = await setWebMessagesForTrip(slug, body.on);
  return result.ok ? json(await readWebMessagesForTrip(slug)) : json({ error: { code: result.code, message: result.message } }, 409);
});
