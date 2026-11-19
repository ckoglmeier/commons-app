import { and, asc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { ItineraryDraft } from "@commons/contracts";
import type { CommandTransaction } from "./event-command";
import { stays, travelPlans } from "./schema";

/** Shared canonical allowlist for conversation, itinerary construction and approval.
 * No private travel, contacts, costs, confirmation codes or original documents.
 * Read one extra row: hitting a bound is incomplete coverage, never "no more records".
 */
export async function loadSavedItineraryAnchors(tx: CommandTransaction, trip: { id: string; startsOn: string | null; endsOn: string | null; timezone: string }) {
  const hotels = await tx.select({ name: stays.name }).from(stays)
    .where(and(eq(stays.commonsId, trip.id), inArray(stays.status, ["planned", "confirmed"])))
    .orderBy(asc(stays.id)).limit(201);
  const flights = await tx.select({ kind: travelPlans.kind, route: travelPlans.route, date: travelPlans.date, time: travelPlans.time, connections: travelPlans.connections }).from(travelPlans)
    .where(and(eq(travelPlans.commonsId, trip.id), inArray(travelPlans.kind, ["arrival", "departure"]), inArray(travelPlans.visibility, ["basic", "all"])))
    .orderBy(asc(travelPlans.id)).limit(201);
  const facts: ItineraryDraft["facts"] = { startsOn: trip.startsOn, endsOn: trip.endsOn, timezone: trip.timezone,
    hotels: hotels.slice(0, 200).map(row => row.name).sort(),
    flights: flights.slice(0, 200).map(row => `${row.kind}: ${row.route} · ${row.date} · ${row.time ?? "time unknown"}${row.connections?.length ? ` · endpoints: ${JSON.stringify(row.connections)}` : ""}`).sort() };
  return { facts, factsFingerprint: createHash("sha256").update(JSON.stringify(facts)).digest("hex"), complete: hotels.length <= 200 && flights.length <= 200 };
}
