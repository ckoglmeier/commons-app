import type { CoordinatorWorkspace } from "@commons/contracts";
import { or, and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { CommandTransaction } from "./event-command";
import { commons, memberships, people, stays, itineraryItems, travelPlans } from "./schema";

/** Conservative freshness gate at proposal commit AND approval. Added/removed/changed inputs invalidate the old planning proposal. */
export async function itineraryPlanningBasisIsCurrent(tx: CommandTransaction, eventId: string, basis: NonNullable<NonNullable<CoordinatorWorkspace["proposal"]>["itineraryBasis"]>) {
  const [trip] = await tx.select({ updatedAt: commons.updatedAt }).from(commons).where(eq(commons.id, eventId));
  if (trip?.updatedAt.toISOString() !== basis.tripVersion) return false;
  const [travelers, lodgings, plans, logistics] = await Promise.all([
    tx.select({ id: memberships.personId, updatedAt: memberships.updatedAt }).from(memberships).innerJoin(people, eq(people.id, memberships.personId)).where(and(eq(memberships.commonsId, eventId), inArray(memberships.status, ["active", "invited"]))).orderBy(asc(people.displayName)).limit(60),
    tx.select({ id: stays.id, updatedAt: stays.updatedAt }).from(stays).where(eq(stays.commonsId, eventId)).orderBy(asc(stays.startsOn), asc(stays.createdAt)).limit(10),
    tx.select({ id: itineraryItems.id, updatedAt: itineraryItems.updatedAt }).from(itineraryItems).where(and(eq(itineraryItems.commonsId, eventId), ne(itineraryItems.status, "cancelled"))).orderBy(sql`${itineraryItems.startsAt} asc nulls last`, asc(itineraryItems.createdAt)).limit(40),
    tx.select({ id: travelPlans.id, updatedAt: travelPlans.updatedAt }).from(travelPlans).where(and(eq(travelPlans.commonsId, eventId), or(inArray(travelPlans.kind, ["arrival", "departure"]), inArray(travelPlans.visibility, ["basic", "all"])))).orderBy(asc(travelPlans.date)).limit(40),
  ]);
  const same = (expected: Array<{ id: string; version: string }>, current: Array<{ id: string; updatedAt: Date }>, prefix: string) => {
    const versions = new Map(current.map(row => [prefix + row.id, row.updatedAt.toISOString()]));
    return expected.length === current.length && expected.every(row => versions.get(row.id) === row.version);
  };
  return same(basis.travelers, travelers, "traveler:") && same(basis.stays, lodgings, "stay:") && same(basis.plans, plans, "plan:") && same(basis.logistics, logistics, "travel:");
}
