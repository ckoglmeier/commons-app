import { after, NextResponse } from "next/server";
import { CommandAccessError, CommandConflictError, PollRepositoryError } from "@commons/database";
import { ZodError } from "zod";
import { loadAuthenticatedPollDelivery, queueAuthenticatedPollDelivery } from "@/lib/server/polls";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons";
import { drainPollDeliveries } from "@/lib/server/poll-delivery";
import { commonsSiteOrigin } from "@/lib/server/runtime-environment";
import { readBoundedJson } from "@/lib/bounded-json";

export const maxDuration = 60;
type Context = { params: Promise<{ slug: string; pollId: string }> };
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers });
  if (error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "This poll is not available to your account." }, { status: 403, headers });
  if (error instanceof PollRepositoryError || error instanceof CommandConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers });
  if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Review the recipients again before sending." }, { status: 400, headers });
  return NextResponse.json({ error: "Delivery could not be updated. Try again." }, { status: 503, headers });
}
export async function GET(_request: Request, { params }: Context) {
  try { const { slug, pollId } = await params; return NextResponse.json({ delivery: await loadAuthenticatedPollDelivery(slug, pollId) }, { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const { slug, pollId } = await params;
    const input = await readBoundedJson(request);
    if (input && typeof input === "object" && "action" in input && input.action === "review") return NextResponse.json({ delivery: await loadAuthenticatedPollDelivery(slug, pollId, "audience" in input ? input.audience : undefined) }, { headers });
    const origin = commonsSiteOrigin();
    const delivery = await queueAuthenticatedPollDelivery(slug, pollId, input);
    after(async () => {
      try { await drainPollDeliveries(origin, pollId); }
      catch { console.error("poll_delivery_worker_failed"); }
    });
    return NextResponse.json({ delivery }, { status: 202, headers });
  } catch (error) { return failure(error); }
}
