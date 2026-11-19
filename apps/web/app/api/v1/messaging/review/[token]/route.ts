import { actOnReview, readReview } from "@/lib/server/messaging/web";
import { json, messagingRoute, notFound } from "@/lib/server/messaging/http";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string }> };

/** The pending summary for the signed-in owner of this intake. Anyone else, a wrong token or an expired link gets the same not-found. */
export const GET = (_request: Request, { params }: Context) => messagingRoute(async () => { const view = await readReview((await params).token); return view ? json(view) : notFound(); });
/** Approve or discard one exact version. A changed summary refuses the approval and saves nothing. */
export const POST = (request: Request, { params }: Context) => messagingRoute(async () => {
  const result = await actOnReview((await params).token, await request.json());
  if (!result) return notFound();
  if (result.ok) return json(result);
  return json({ error: { code: "reason" in result ? result.reason : "failed", message: "That summary changed or couldn't be saved. Review the latest one." } }, 409);
});
