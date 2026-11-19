import { proposeTransferGroups, type RecipeContext, type TransportLeg, type TransportProposal } from "@commons/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { isCommonsId } from "./commons-identifier";
import { CommandAccessError } from "./event-command";
import type { PollRepositoryOptions } from "./poll-repository";
import { commons, memberships, people, recipeOutcomes, recipeRuns, travelPlans } from "./schema";
import { readRecipeContext } from "./recipe-context";

export type TransportReview = { tripName: string; tripTimezone: string; travelers: number; flights: number; proposal: TransportProposal; context: RecipeContext };

const parts = (route: string) => route.split(/\s*(?:→|->|—>|\bto\b)\s*/i).map(part => part.trim()).filter(Boolean);
const zone = (value: string | null | undefined) => value?.trim() || null;

/**
 * Read-only suggestions from flights people already added. Flights are shared as basic details with the whole trip, so reading
 * route, date and time here exposes nothing a traveler hasn't already shared; costs, notes and confirmation codes are never selected.
 * Nothing is saved, assigned, booked or sent.
 */
export async function getTransportReview(identifier: string, options: PollRepositoryOptions & { windowMinutes?: number }): Promise<TransportReview> {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [event] = await tx.select({ id: commons.id, name: commons.name, timezone: commons.timezone, startsOn: commons.startsOn, endsOn: commons.endsOn, locationName: commons.locationName, locationNames: commons.locationNames }).from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).for("update");
      const [actor] = event ? await tx.select({ role: memberships.role, status: memberships.status }).from(memberships).where(and(eq(memberships.commonsId, event.id), eq(memberships.personId, options.actorPersonId))) : [];
      if (!event || actor?.status !== "active" || actor.role !== "organizer") throw new CommandAccessError();
      const context = await readRecipeContext(tx, event.id, { startsOn: event.startsOn, endsOn: event.endsOn,
        locationNames: event.locationNames.length ? event.locationNames : event.locationName ? [event.locationName] : [] });
      const roster = await tx.select({ personId: people.id, name: people.displayName, status: memberships.status, attendance: memberships.attendanceState }).from(memberships)
        .innerJoin(people, eq(people.id, memberships.personId)).where(and(eq(memberships.commonsId, event.id), inArray(memberships.status, ["active", "invited"])));
      const byId = new Map(roster.map(person => [person.personId, person]));
      // Confirmed means they said so on the trip (their own RSVP) or the approved attendance result lists them as in. A maybe or an unknown is provisional.
      const [attendance] = await tx.select({ result: recipeOutcomes.result }).from(recipeOutcomes).innerJoin(recipeRuns, eq(recipeRuns.id, recipeOutcomes.runId))
        .where(and(eq(recipeRuns.commonsId, event.id), eq(recipeOutcomes.kind, "attendance"), inArray(recipeOutcomes.status, ["approved", "applied"]))).orderBy(desc(recipeOutcomes.createdAt)).limit(1);
      const attendanceCurrent = Boolean(context.sources.find(source => source.kind === "attendance" && !source.stale.length && !source.reconsidering));
      const recordedIn = new Set(attendanceCurrent && attendance?.result.kind === "attendance" ? attendance.result.people.flatMap(person => person.state === "in" && person.personId ? [person.personId] : []) : []);
      const plans = await tx.select({ personId: travelPlans.personId, companionPersonId: travelPlans.companionPersonId, kind: travelPlans.kind, date: travelPlans.date, time: travelPlans.time,
        route: travelPlans.route, connections: travelPlans.connections }).from(travelPlans).where(and(eq(travelPlans.commonsId, event.id), inArray(travelPlans.kind, ["arrival", "departure"])));
      const own = new Set(plans.map(plan => `${plan.personId}|${plan.kind}`));
      const legs: TransportLeg[] = [];
      for (const plan of plans) {
        const direction = plan.kind as "arrival" | "departure", segments = parts(plan.route), first = plan.connections[0], last = plan.connections.at(-1);
        const place = (direction === "arrival" ? segments.at(-1) : segments[0]) ?? null;
        const timezone = zone(direction === "arrival" ? last?.arrivalTimezone : first?.departureTimezone);
        // A plan also covers the one traveler included with its owner, unless that person added their own flight.
        for (const personId of [plan.personId, ...(plan.companionPersonId && !own.has(`${plan.companionPersonId}|${plan.kind}`) ? [plan.companionPersonId] : [])]) {
          const person = byId.get(personId);
          if (!person) continue;
          legs.push({ personId, name: person.name, direction, place, date: plan.date, time: plan.time ?? null, timezone, provisional: person.status !== "active" || !(person.attendance === "attending" || recordedIn.has(personId)) });
        }
      }
      const proposal = proposeTransferGroups({ legs, tripTimezone: event.timezone, windowMinutes: options.windowMinutes, roster: roster.map(person => ({ personId: person.personId, name: person.name })) });
      return { tripName: event.name, tripTimezone: event.timezone, travelers: roster.length, flights: legs.length, proposal, context };
    });
  } finally { await database.close(); }
}
