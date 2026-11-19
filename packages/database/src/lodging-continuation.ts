import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import {
  LodgingPreparationIntentSchema, ResearchBriefSchema, SpecialistResearchSchema,
  type CoordinatorWorkspace, type LodgingPreparationIntent, type LodgingPreparationOutcome, type ResearchRun, type TripChangeProposal,
} from "@commons/contracts";
import { lodgingAdapterFor, lodgingDatesComplete, sameApprovedSnapshot, searchInputFromBrief, stayMatchesPrepared } from "@commons/domain/lodging";
import { CommandConflictError, type CommandTransaction } from "./event-command";
import { auditEvents, processedCommands } from "./schema";
import { hash, readKeyed, recordKey, resolveActor, TripCoordinationError, withTransaction, type CoordinationOptions } from "./coordination-store";
import { approvedStaySnapshot, assembleLodgingBrief, researchWithFreshness, sharedTripState, type ResearchRecord } from "./lodging-state";

/*
 * Commons-native continuation of the lodging review. There is no second executor and nothing waits in a process: the saved proposal IS the wait, and the
 * existing apply command is the continuation trigger. The intent saved with the proposal authorizes nothing; the apply transaction rechecks it, writes the
 * canonical receipt and the preparation outcome together, and keys that outcome by (trip, proposal turn, applied version, continuation kind) through the
 * audit table's unique command id. No model is called after review, and the brief is preparation only.
 */

export const LODGING_CONTINUATION = "prepare_lodging_brief";
const researchKey = (commandId: string) => recordKey("lodging-research", commandId);
const continuationKey = (turnId: string, version: number) => `${LODGING_CONTINUATION}:${turnId}:v${version}`;

/** An apply refused because the shared facts or constraints the stay was prepared from have changed. Nothing was saved; the review cannot be applied as it is. */
export class LodgingReviewStaleError extends CommandConflictError {
  readonly reason = "constraints_changed" as const;
  constructor() { super(); this.name = "LodgingReviewStaleError"; }
}

/** The trip's saved dates as they are now, for the organizer asking. Lodging is never researched or proposed without both. */
export async function lodgingTripDates(identifier: string, options: CoordinationOptions): Promise<{ startsOn: string | null; endsOn: string | null }> {
  return withTransaction(options, async tx => {
    const { trip } = await sharedTripState(tx, (await resolveActor(tx, identifier, options.actorPersonId, "organizer", false)).tripId);
    return { startsOn: trip.startsOn, endsOn: trip.endsOn };
  });
}

// --- Shortlist ---------------------------------------------------------------------------------------------------------------

async function readResearch(tx: CommandTransaction, tripId: string, commandId: string): Promise<ResearchRecord | null> {
  return readKeyed<ResearchRecord>(tx, tripId, researchKey(commandId));
}

export type LodgingShortlist = { commandId: string; run: ResearchRun };

/**
 * Researches lodging for the saved dates and SHARED constraints only, and saves the shortlist with the version it was briefed against. Idempotent by
 * command id, so Try again on the same request returns the same shortlist. The search runs outside any transaction (a real provider would be a network
 * call). Refuses (`dates_required`) when the trip lacks complete saved dates, before any search. Returns null when nothing fits.
 */
export async function recordLodgingShortlist(identifier: string, input: { commandId: string; focus: string }, options: CoordinationOptions): Promise<LodgingShortlist | null> {
  const prepared = await withTransaction(options, async tx => {
    const actor = await resolveActor(tx, identifier, options.actorPersonId, "organizer", false);
    const state = await sharedTripState(tx, actor.tripId);
    const existing = await readResearch(tx, actor.tripId, input.commandId);
    if (existing) return { existing: researchWithFreshness(existing, state.version) };
    if (!lodgingDatesComplete(state.trip)) throw new TripCoordinationError("dates_required");
    const brief = ResearchBriefSchema.parse({ focus: input.focus.slice(0, 300) || "Lodging for the group", startsOn: state.trip.startsOn, endsOn: state.trip.endsOn, locationName: state.trip.locationName,
      returnAudience: "shared", constraints: state.shared.map(item => ({ kind: item.kind, text: item.text, value: item.value })) });
    return { existing: null, brief, version: state.version, constraintIds: state.shared.map(item => item.id) };
  });
  if (prepared.existing) return { commandId: input.commandId, run: prepared.existing };
  const adapter = lodgingAdapterFor(process.env.COMMONS_LODGING_RESEARCH_ADAPTER);
  const found = await adapter.search(searchInputFromBrief(prepared.brief));
  if (!found.options.length) return null;
  const result = SpecialistResearchSchema.parse({ ...found, uncertainty: adapter.synthetic ? ["All evidence is synthetic fixture data; prices and availability are not real."] : [] });
  return withTransaction(options, async tx => {
    const actor = await resolveActor(tx, identifier, options.actorPersonId, "organizer");
    const current = (await sharedTripState(tx, actor.tripId)).version;
    const existing = await readResearch(tx, actor.tripId, input.commandId);
    if (existing) return { commandId: input.commandId, run: researchWithFreshness(existing, current) };
    const record: ResearchRecord = { kind: "commons.lodging_research", fingerprint: hash(result), commandId: input.commandId, constraintIds: prepared.constraintIds,
      run: { ...result, runId: randomUUID(), constraintVersion: prepared.version, adapter: adapter.id, synthetic: adapter.synthetic, createdAt: new Date().toISOString() } };
    await tx.insert(processedCommands).values({ commonsId: actor.tripId, commandId: researchKey(input.commandId), result: record });
    return { commandId: input.commandId, run: researchWithFreshness(record, current) };
  });
}

/**
 * The saved lodging shortlists among the given research runs (the ones a conversation shows), with freshness derived now. Organizers only. Runs that are
 * not lodging shortlists, or belong to another trip, are simply absent: a choice is only ever bound to a shortlist the person's own conversation shows.
 */
export async function lodgingShortlistsForRuns(identifier: string, runIds: string[], options: CoordinationOptions): Promise<LodgingShortlist[]> {
  if (!runIds.length) return [];
  return withTransaction(options, async tx => {
    const actor = await resolveActor(tx, identifier, options.actorPersonId, "organizer", false);
    const rows = await tx.select({ result: processedCommands.result }).from(processedCommands).where(and(eq(processedCommands.commonsId, actor.tripId), like(processedCommands.commandId, researchKey("%"))));
    const version = (await sharedTripState(tx, actor.tripId)).version, wanted = new Set(runIds);
    return rows.map(row => row.result as ResearchRecord).filter(record => wanted.has(record.run.runId)).map(record => ({ commandId: record.commandId, run: researchWithFreshness(record, version) }));
  });
}

// --- Prepare (the intent is saved together with the proposal by completeCoordinatorTurn) ----------------------------------------

/**
 * Validates a choice from a saved shortlist and returns the typed intent to save with the proposal. Writes nothing. Refuses stale research, an option the
 * shortlist never produced, and a trip without complete dates.
 */
export async function prepareLodgingIntent(identifier: string, input: { researchCommandId: string; optionId: string; travelerIds: string[] }, options: CoordinationOptions): Promise<{ intent: LodgingPreparationIntent; option: ResearchRun["options"][number] }> {
  return withTransaction(options, async tx => {
    const actor = await resolveActor(tx, identifier, options.actorPersonId, "organizer");
    const state = await sharedTripState(tx, actor.tripId);
    const record = await readResearch(tx, actor.tripId, input.researchCommandId);
    if (!record) throw new TripCoordinationError("not_found");
    const run = researchWithFreshness(record, state.version);
    if (run.status !== "current") throw new TripCoordinationError("stale_research");
    const option = run.options.find(item => item.optionId === input.optionId);
    if (!option) throw new TripCoordinationError("not_found");
    if (!lodgingDatesComplete(state.trip)) throw new TripCoordinationError("dates_required");
    const members = new Set(state.members.map(item => item.personId));
    const intent = LodgingPreparationIntentSchema.parse({ schemaVersion: 1, nextAction: LODGING_CONTINUATION, researchCommandId: input.researchCommandId, researchRunId: run.runId, optionId: option.optionId,
      constraintVersion: state.version, constraintIds: record.constraintIds, travelerIds: input.travelerIds.filter(id => members.has(id)), requestedByPersonId: options.actorPersonId,
      stay: { name: option.name, address: option.address, startsOn: state.trip.startsOn, endsOn: state.trip.endsOn, totalCents: option.totalCents } });
    return { intent, option };
  });
}

// --- Apply (called inside the existing apply transaction) -------------------------------------------------------------------------

/** Before anything is applied: a review prepared from facts or constraints that have since changed is refused, not applied with substituted inputs. */
export async function assertLodgingReviewCurrent(tx: CommandTransaction, tripId: string, proposal: TripChangeProposal): Promise<void> {
  const intent = proposal.preparation?.intent;
  if (!intent) return;
  if ((await sharedTripState(tx, tripId)).version !== intent.constraintVersion) throw new LodgingReviewStaleError();
}

/**
 * After the reviewed stay is applied and the receipt is on the proposal, in the same transaction: prepares the brief from the committed records, or
 * records why it could not, without undoing the applied stay. Exactly one outcome per applied version: the audit row's unique command id makes a second one
 * impossible, and a repeated apply never reaches here (it is answered from the command ledger). The audit actor is Commons; the approval is the human's.
 */
export async function continueLodgingAfterApply(tx: CommandTransaction, tripId: string, input: { turnId: string; proposal: TripChangeProposal; approver: { personId: string; name: string; at: string }; enabled: boolean }): Promise<LodgingPreparationOutcome | null> {
  const { proposal, approver } = input, intent = proposal.preparation?.intent;
  if (!intent || proposal.state !== "applied" || !proposal.receipt) return null;
  const base = { appliedVersion: proposal.version, preparedAt: approver.at };
  const unavailable = (reason: Extract<LodgingPreparationOutcome, { status: "unavailable" }>["reason"]): LodgingPreparationOutcome => ({ status: "unavailable", ...base, reason });
  let outcome: LodgingPreparationOutcome;
  const snapshot = await approvedStaySnapshot(tx, tripId, proposal.receipt.stayId);
  if (!input.enabled) outcome = unavailable("not_enabled");
  else if (!stayMatchesPrepared(proposal.changes.stay, intent.stay)) outcome = unavailable("edited_in_review");
  else if (!snapshot) outcome = unavailable("stay_missing");
  else {
    const brief = await assembleLodgingBrief(tx, tripId, { snapshot, research: await readResearch(tx, tripId, intent.researchCommandId), optionId: intent.optionId, constraintIds: intent.constraintIds,
      fallbackTotalCents: intent.stay.totalCents, approval: { proposalTurnId: input.turnId, version: proposal.version, approvedByPersonId: approver.personId, approvedByName: approver.name, approvedAt: proposal.receipt.at } });
    outcome = { status: "prepared", ...base, brief, approvedSnapshot: snapshot };
  }
  await tx.insert(auditEvents).values({ commonsId: tripId, commandId: continuationKey(input.turnId, proposal.version), actorId: "commons", actorType: "commons",
    action: outcome.status === "prepared" ? "commons.lodging_brief_prepared" : "commons.lodging_brief_unavailable", resourceType: "coordinator_turn", resourceId: input.turnId,
    summary: outcome.status === "prepared" ? `Commons prepared a preparation-only booking brief after ${approver.name} applied the reviewed stay. Nothing was booked.`
      : `Commons did not prepare a booking brief after ${approver.name} applied the reviewed stay (${outcome.reason}). The applied stay is kept.` });
  return outcome;
}

/**
 * Read-time freshness, never written back: a prepared brief whose saved stay was edited or deleted after approval is marked out of date. It is never rebuilt
 * under the original approval.
 */
export async function annotateLodgingFreshness(tx: CommandTransaction, tripId: string, workspaces: Array<CoordinatorWorkspace | null | undefined>): Promise<void> {
  for (const workspace of workspaces) {
    const outcome = workspace?.tripProposal?.preparation?.outcome;
    if (outcome?.status !== "prepared") continue;
    if (!sameApprovedSnapshot(outcome.approvedSnapshot, await approvedStaySnapshot(tx, tripId, outcome.approvedSnapshot.stay.id))) outcome.staleSinceApproval = true;
  }
}
