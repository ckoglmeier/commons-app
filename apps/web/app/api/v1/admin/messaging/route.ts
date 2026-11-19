import { messagingHealth, requeueFailedOutbound } from "@commons/database";
import { json, messagingRoute, notFound } from "@/lib/server/messaging/http";
import { CommonsOperatorRequiredError, requireCommonsOperator } from "@/lib/server/operator";
import { requireCommonsDatabaseUrl } from "@/lib/server/runtime-environment";

export const dynamic = "force-dynamic";
async function operator() {
  try { return await requireCommonsOperator(); } catch (error) { if (error instanceof CommonsOperatorRequiredError) return null; throw error; }
}
/** Operator view of messaging health: counts, failures and stuck work by id and status. It never returns a message body, a number or a person. */
export const GET = () => messagingRoute(async () => (await operator()) ? json(await messagingHealth({ databaseUrl: requireCommonsDatabaseUrl() })) : notFound());
/** Retry one failed or undelivered message. The retry goes back through every send-time check; nothing is sent blindly. */
export const POST = (request: Request) => messagingRoute(async () => {
  if (!(await operator())) return notFound();
  const body = await request.json() as { messageId?: unknown };
  if (typeof body.messageId !== "string") return json({ error: { code: "invalid" } }, 400);
  return json({ requeued: await requeueFailedOutbound(body.messageId, { databaseUrl: requireCommonsDatabaseUrl() }) });
});
