import { ActivityIdeaReceiptSchema, activityTitleKey, parseOrganizerActivities, type ActivityIdeaReceipt } from "@commons/contracts";
import { and, eq, ne } from "drizzle-orm";
import { runEventCommand, CommandAccessError, type CommandTransaction } from "./event-command";
import { commons, itineraryItems } from "./schema";

/** Stored human words are the authority. This function cannot accept model-generated titles. */
export async function addCoordinatorActivitiesInTransaction(tx: CommandTransaction, request: {
  tripId: string; actorPersonId: string; turnId: string; commandId: string; userText: string;
}): Promise<ActivityIdeaReceipt> {
  const parsed = parseOrganizerActivities(request.userText);
  if (!parsed || parsed.error) throw new Error("Activity list is not authorized.");
  const result = await runEventCommand(tx, {
    identifier: request.tripId, actorPersonId: request.actorPersonId,
    commandId: `${request.commandId}:activities`, action: "itinerary.activities_added",
    input: { turnId: request.turnId, userText: request.userText },
  }, actor => { if (actor.role !== "organizer") throw new CommandAccessError(); }, async actor => {
    const [trip] = await tx.select({ timezone: commons.timezone }).from(commons).where(eq(commons.id, actor.id));
    const existing = await tx.select({ id: itineraryItems.id, title: itineraryItems.title }).from(itineraryItems)
      .where(and(eq(itineraryItems.commonsId, actor.id), ne(itineraryItems.status, "cancelled")));
    const byTitle = new Map(existing.map(item => [activityTitleKey(item.title), item]));
    const items: ActivityIdeaReceipt["items"] = [];
    for (const title of parsed.titles) {
      const saved = byTitle.get(activityTitleKey(title));
      if (saved) { items.push({ id: saved.id, title, status: "existing" }); continue; }
      const [item] = await tx.insert(itineraryItems).values({
        commonsId: actor.id, title, timezone: trip.timezone, audience: "individual", status: "idea",
        provenanceLabel: `${actor.displayName} added this in Commons`,
      }).returning({ id: itineraryItems.id, title: itineraryItems.title });
      items.push({ ...item, status: "added" });
    }
    const receipt = ActivityIdeaReceiptSchema.parse({ at: actor.now.toISOString(), items });
    const added = items.filter(item => item.status === "added").length;
    return { result: receipt, resourceType: "coordinator_turn", resourceId: request.turnId,
      summary: `${actor.displayName} added ${added} activity ideas; ${items.length - added} already existed.` };
  });
  return ActivityIdeaReceiptSchema.parse(result);
}

export function activityReceiptReply(receipt: ActivityIdeaReceipt) {
  const added = receipt.items.filter(item => item.status === "added").length, existing = receipt.items.length - added;
  return [
    added ? `Saved ${added} activity ${added === 1 ? "idea" : "ideas"} in Plan. ${added === 1 ? "It’s" : "They’re"} undated and unconfirmed.` : null,
    existing ? `${existing} ${existing === 1 ? "activity is" : "activities are"} already in Plan; no duplicates were added.` : null,
  ].filter(Boolean).join(" ");
}
