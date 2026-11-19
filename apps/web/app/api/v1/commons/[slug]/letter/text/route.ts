import { NextResponse } from "next/server";
import { z } from "zod";
import { homeUpdates } from "@/lib/home-dashboard";
import { loadCommonsSnapshot } from "@/lib/server/commons";
import { messagingDeps } from "@/lib/server/messaging/core";
import { queueSettlementReminders, queueTripChange } from "@/lib/server/messaging/planner";
import { messagingRoute } from "@/lib/server/messaging/http";

const RequestSchema = z.object({ kind: z.enum(["update", "settlement"]) }).strict();

/**
 * An organizer's explicit request to text the people who opted in. The content is built here from saved, shared facts rather than
 * taken from the browser. Each change is queued once per person, and quiet hours, cadence, consent and usage limits still apply at send.
 */
export const POST = (request: Request, { params }: { params: Promise<{ slug: string }> }) => messagingRoute(async () => {
  const { slug } = await params;
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose what to text." }, { status: 400 });
  const snapshot = await loadCommonsSnapshot(slug).catch(() => null);
  if (!snapshot || snapshot.currentActor.role !== "organizer") return NextResponse.json({ error: "Only an organizer can text the group." }, { status: 403 });
  // Without Twilio settings there's no SMS provider; messages in Commons still reach travelers' threads.
  const deps = await messagingDeps({ allowNoProvider: true });
  if (parsed.data.kind === "settlement") return NextResponse.json({ queued: await queueSettlementReminders(deps, snapshot.commons.id) });
  const forEveryone = new Set(snapshot.state.itinerary.filter(item => item.participantScope === "everyone").map(item => item.id));
  const updates = homeUpdates(snapshot.state, { includeMessages: false })
    .filter(update => update.destination === "plan" ? Boolean(update.itemId && forEveryone.has(update.itemId)) : update.destination === "logistics")
    .slice(0, 2);
  if (!updates.length) return NextResponse.json({ error: "There’s nothing new to share yet." }, { status: 409 });
  const queued = await queueTripChange(deps, snapshot.commons.id, {
    kind: "update",
    summary: updates.map(update => update.title).join(", "),
    evidence: updates.map(update => update.id).join(","),
  });
  return NextResponse.json({ queued });
});
