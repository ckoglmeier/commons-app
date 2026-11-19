import { and, eq, inArray } from "drizzle-orm";
import { ResearchRunSchema, type BookingBrief, type ResearchRun } from "@commons/contracts";
import { buildLodgingBrief, type ApprovedStaySnapshot, type LodgingBriefInput } from "@commons/domain/lodging";
import type { CommandTransaction } from "./event-command";
import { commons, memberships, people, stayParticipants, stays } from "./schema";
import { hash, type KeyedRecord } from "./coordination-store";
import { listTripConstraints } from "./trip-constraints";

/*
 * Saved lodging facts the Commons-native lodging journey reads inside its own transactions: the shared state research is fresh against, a saved shortlist's
 * freshness, the approved stay snapshot and the brief assembled from them. Nothing here writes, calls a model or reaches a provider.
 */

/** The shared state research and decisions are fresh against: the saved facts, attendance, and SHARED constraints. A private note never moves it. */
export async function sharedTripState(tx: CommandTransaction, tripId: string) {
  const [trip] = await tx.select().from(commons).where(eq(commons.id, tripId));
  const members = await tx.select({ personId: people.id, name: people.displayName, role: memberships.role, attendanceState: memberships.attendanceState, attendanceDates: memberships.attendanceDates })
    .from(memberships).innerJoin(people, eq(people.id, memberships.personId)).where(and(eq(memberships.commonsId, tripId), inArray(memberships.status, ["active", "invited"])));
  const shared = (await listTripConstraints(tx, tripId)).filter(item => item.audience === "shared").sort((a, b) => a.version - b.version);
  const version = hash({ name: trip.name, locationName: trip.locationName, startsOn: trip.startsOn, endsOn: trip.endsOn, budget: trip.targetBudgetCents,
    members: members.map(item => [item.personId, item.attendanceState, item.attendanceDates]).sort(), constraints: shared.map(item => [item.id, item.version]) });
  return { trip, members, shared, version };
}

/** A stored shortlist. `constraintIds` are the shared constraints it was briefed with; constraints added later are not part of it. */
export type ResearchRecord = KeyedRecord & { kind: "commons.lodging_research"; fingerprint: string; run: Omit<ResearchRun, "status">; commandId: string; constraintIds: string[] };

/** Freshness is derived on every read, never stored. */
export const researchWithFreshness = (record: ResearchRecord, currentVersion: string): ResearchRun => ResearchRunSchema.parse({ ...record.run, status: record.run.constraintVersion === currentVersion ? "current" : "stale" });

/** The saved stay and its travelers as they are now, in the shape that was approved. Null when the stay no longer exists on this trip. */
export async function approvedStaySnapshot(tx: CommandTransaction, tripId: string, stayId: string | null): Promise<ApprovedStaySnapshot | null> {
  if (!stayId) return null;
  const [stay] = await tx.select().from(stays).where(and(eq(stays.id, stayId), eq(stays.commonsId, tripId)));
  if (!stay) return null;
  const travelers = await tx.select({ personId: stayParticipants.personId }).from(stayParticipants).where(eq(stayParticipants.stayId, stay.id));
  return { stay: { id: stay.id, name: stay.name, address: stay.address, startsOn: stay.startsOn, endsOn: stay.endsOn, totalCents: stay.totalCents, currency: stay.currency }, travelerIds: travelers.map(item => item.personId).sort() };
}

/**
 * Assembles the preparation-only brief from the approved snapshot and the shortlist the option came from. Only SHARED constraints are read, so a private
 * constraint can never appear in it. The caller has already checked the approval; this only reads.
 */
export async function assembleLodgingBrief(tx: CommandTransaction, tripId: string, input: { snapshot: ApprovedStaySnapshot; research: ResearchRecord | null; optionId: string; constraintIds: string[]; fallbackTotalCents: number; approval: LodgingBriefInput["approval"] }): Promise<BookingBrief> {
  const state = await sharedTripState(tx, tripId);
  const run = input.research ? researchWithFreshness(input.research, state.version) : null;
  const option = run?.options.find(item => item.optionId === input.optionId);
  const evidenceUrls = run && option ? option.evidenceIds.map(id => run.evidence.find(item => item.id === id)?.url).filter((url): url is string => Boolean(url)) : [];
  const travelers = input.snapshot.travelerIds.length ? await tx.select({ personId: people.id, name: people.displayName }).from(people).where(inArray(people.id, input.snapshot.travelerIds)) : [];
  const used = new Set(input.constraintIds);
  const unconfirmed = await tx.select({ name: people.displayName }).from(memberships).innerJoin(people, eq(people.id, memberships.personId))
    .where(and(eq(memberships.commonsId, tripId), eq(memberships.status, "active"), eq(memberships.attendanceState, "helping")));
  return buildLodgingBrief({ tripName: state.trip.name, locationName: state.trip.locationName, snapshot: input.snapshot, fallbackTotalCents: input.fallbackTotalCents,
    travelers: travelers.map(person => ({ personId: person.personId, name: person.name })), research: run ? { synthetic: run.synthetic, evidenceUrls } : null,
    constraintsApplied: state.shared.filter(item => used.has(item.id)).map(item => item.text), constraintsAddedLater: state.shared.filter(item => !used.has(item.id)).map(item => item.text),
    attendanceUnconfirmed: unconfirmed.map(person => person.name), approval: input.approval });
}
