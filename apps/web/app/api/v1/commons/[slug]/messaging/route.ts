import { enroll, readEnrollment, withdraw } from "@/lib/server/messaging/web";
import { json, messagingRoute } from "@/lib/server/messaging/http";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ slug: string }> };

/** The signed-in person's own texting status for this trip, and the exact consent wording. */
export const GET = (_request: Request, { params }: Context) => messagingRoute(async () => json(await readEnrollment((await params).slug)));
/** Turn on texts for this trip. The number must be the one the person already verified. This is the only place consent is created. */
export const POST = (request: Request, { params }: Context) => messagingRoute(async () => {
  const result = await enroll((await params).slug, await request.json());
  return result.ok ? json(result) : json({ error: { code: result.code, message: result.message } }, result.code === "invalid_number" ? 400 : 409);
});
/** Turn texts off for this trip. The trip stays fully available on the web. */
export const DELETE = (_request: Request, { params }: Context) => messagingRoute(async () => { await withdraw((await params).slug); return json({ enrolled: false }); });
