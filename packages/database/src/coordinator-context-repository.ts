import { createHash } from "node:crypto";
import { tripTasks } from "./schema";
import { publicActivityWebsite, readTripPlanningBrief, TripContextSnapshotSchema, type CapabilityId, type ThreadIndexEntry, type TripContextSnapshot } from "@commons/contracts";
import { and, asc, count, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, coordinatorResearchRuns, coordinatorThreadIdeas, coordinatorThreads, coordinatorTurns, expenses, itineraryItems, memberships, people, pollDecisions, pollDrafts, pollResponses, polls, stays, stayParticipants, travelPlanParticipants, travelPlans } from "./schema";
import { pollResultsAreVisible, type PollRepositoryOptions } from "./poll-repository";
import { requireTripOrganizer } from "./coordinator-turn-repository";
import { readThreadMeta, turnIsCompletedSql } from "./coordinator-turn-lifecycle";
import { CoordinatorTurnError } from "./coordinator-errors";
import { loadSavedItineraryAnchors } from "./itinerary-anchors";
import type { CommandTransaction } from "./event-command";
import { readFoodPlanningContext } from "./food-planning-context";

/*
 * Authorized trip context (design §6). Only active organizers receive a snapshot,
 * and only the fields listed below leave the database layer. Deliberately absent:
 * emails, phones, auth ids, traveler profiles (dietary/accessibility/preferences),
 * private travel plans, confirmation codes, booking URLs, stay details and
 * documents, ballots and respondent names, share tokens, legacy owner-private
 * turns and drafts, private recommendations, and owner-only setup conversations.
 * Exception: explicitly organizer-only food Goal answers have their own live, sourced projection.
 */

const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;

/** Interprets a local wall-clock date and "HH:MM" time in an IANA zone. Null when the time is absent or unparseable. */
export function zonedLocalToIso(date: string, time: string | null, timeZone: string): string | null {
  const match = time ? /^(\d{1,2}):(\d{2})/.exec(time) : null;
  if (!match) return null;
  const [year, month, day] = date.split("-").map(Number), hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(new Date(asUtc)).reduce<Record<string, number>>((all, part) => (part.type === "literal" ? all : { ...all, [part.type]: Number(part.value) }), {});
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    return new Date(asUtc - (shown - asUtc)).toISOString();
  } catch { return null; }
}

function truncate(value: string, max: number) { return value.length <= max ? value : `${value.slice(0, max - 1)}…`; }

type ContextOptions = PollRepositoryOptions & { now?: Date; activeThreadId?: string; includeOwnTravel?: boolean; capabilities?: CapabilityId[] };
export async function loadCoordinatorTripContext(identifier: string, options: ContextOptions): Promise<TripContextSnapshot> {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(tx => loadCoordinatorTripContextInTransaction(tx, identifier, options));
  } finally { await database.close(); }
}

/** Reuses the exact authorized reader inside a caller's existing transaction.
 * Callers needing serialization must already hold the trip lock; this reader
 * does not independently grant execution, extend privacy or acquire a lease. */
export async function loadCoordinatorTripContextInTransaction(tx: CommandTransaction, identifier: string, options: ContextOptions): Promise<TripContextSnapshot> {
  const now = options.now ?? new Date(), asOf = now.toISOString();
      const eventId = await requireTripOrganizer(tx, identifier, options.actorPersonId, false);
      const fresh = (updatedAt: Date | null | string) => ({ asOf, updatedAt: typeof updatedAt === "string" ? updatedAt : iso(updatedAt) });
      const saved = (recordType: TripContextSnapshot["stays"][number]["provenance"]["recordType"], recordId: string | null, label: string | null = null) =>
        ({ kind: "saved_record" as const, recordType, recordId, threadId: null, label });

      const [trip] = await tx.select().from(commons).where(eq(commons.id, eventId));
      const roster = await tx.select({ personId: memberships.personId, name: people.displayName, role: memberships.role, status: memberships.status,
        accessMode: memberships.accessMode, attendance: memberships.attendanceState, attendanceDates: memberships.attendanceDates, updatedAt: memberships.updatedAt })
        .from(memberships).innerJoin(people, eq(people.id, memberships.personId))
        .where(and(eq(memberships.commonsId, eventId), inArray(memberships.status, ["active", "invited"]))).orderBy(asc(people.displayName)).limit(60);

      const stayRows = await tx.select().from(stays).where(eq(stays.commonsId, eventId)).orderBy(asc(stays.startsOn), asc(stays.createdAt)).limit(10);
      const included = stayRows.length ? await tx.select({ stayId: stayParticipants.stayId, personId: stayParticipants.personId }).from(stayParticipants).where(inArray(stayParticipants.stayId, stayRows.map(row => row.id))) : [];

      const planRows = await tx.select().from(itineraryItems).where(and(eq(itineraryItems.commonsId, eventId), ne(itineraryItems.status, "cancelled")))
        .orderBy(sql`${itineraryItems.startsAt} asc nulls last`, asc(itineraryItems.createdAt)).limit(40);

      const travelRows = await tx.select().from(travelPlans).where(and(eq(travelPlans.commonsId, eventId), or(or(inArray(travelPlans.kind, ["arrival", "departure"]), inArray(travelPlans.visibility, ["basic", "all"])), options.includeOwnTravel ? eq(travelPlans.personId, options.actorPersonId) : undefined))).orderBy(asc(travelPlans.date)).limit(40);
      const travelParticipants = travelRows.length ? await tx.select({ planId: travelPlanParticipants.travelPlanId, personId: travelPlanParticipants.personId }).from(travelPlanParticipants).where(inArray(travelPlanParticipants.travelPlanId, travelRows.map(row => row.id))) : [];

      const expenseCurrencyTotals = await tx.select({ currency: expenses.currency, total: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::int`, count: count() }).from(expenses)
        .where(and(eq(expenses.commonsId, eventId), ne(expenses.balanceMode, "budget_only"))).groupBy(expenses.currency).orderBy(asc(expenses.currency));
      const expenseTotals = expenseCurrencyTotals.find(row => row.currency === trip.targetBudgetCurrency) ?? { total: 0, count: 0 };

      const pollRows = await tx.select({ id: polls.id, title: polls.title, status: polls.status, ballotMode: polls.ballotMode, questions: polls.questions, threadId: polls.threadId, updatedAt: polls.updatedAt })
        .from(polls).where(and(eq(polls.commonsId, eventId), ne(polls.status, "revoked"), sql`${polls.archivedAt} is null`)).orderBy(desc(polls.createdAt)).limit(20);
      const responses = pollRows.length ? await tx.select({ pollId: pollResponses.pollId, answers: pollResponses.answers }).from(pollResponses).where(inArray(pollResponses.pollId, pollRows.map(row => row.id))) : [];
      const decisions = pollRows.length ? await tx.select({ id: pollDecisions.id, pollId: pollDecisions.pollId, summary: pollDecisions.summary, approvedByName: pollDecisions.approvedByName, createdAt: pollDecisions.createdAt })
        .from(pollDecisions).where(inArray(pollDecisions.pollId, pollRows.map(row => row.id))) : [];

      const sharedTurns = await tx.select({ id: coordinatorTurns.id, threadId: coordinatorTurns.threadId, workspace: coordinatorTurns.workspace, createdAt: coordinatorTurns.createdAt })
        .from(coordinatorTurns).where(and(eq(coordinatorTurns.commonsId, eventId), eq(coordinatorTurns.organizerShared, true), turnIsCompletedSql, isNotNull(coordinatorTurns.workspace)))
        .orderBy(desc(coordinatorTurns.createdAt)).limit(200);

      // Thread index: shared organizer threads only. Owner-private legacy turns have no thread and are never read here.
      const threadRows = await tx.select().from(coordinatorThreads).where(eq(coordinatorThreads.commonsId, eventId)).orderBy(desc(coordinatorThreads.updatedAt)).limit(40);
      if (options.activeThreadId && !threadRows.some(row => row.id === options.activeThreadId)) {
        const [active] = await tx.select().from(coordinatorThreads).where(and(eq(coordinatorThreads.id, options.activeThreadId), eq(coordinatorThreads.commonsId, eventId)));
        if (active) threadRows.push(active);
      }
      const threadIds = threadRows.map(row => row.id);
      const meta = await readThreadMeta(tx, eventId, threadRows);
      const [versionRows, draftRows, threadPolls, researchRows, ideaRows] = threadIds.length ? await Promise.all([
        tx.select({ threadId: coordinatorTurns.threadId, version: sql<number>`coalesce(max(${coordinatorTurns.sequence}), 0)::int` }).from(coordinatorTurns).where(inArray(coordinatorTurns.threadId, threadIds)).groupBy(coordinatorTurns.threadId),
        tx.select({ threadId: pollDrafts.threadId, count: count() }).from(pollDrafts).where(and(inArray(pollDrafts.threadId, threadIds), eq(pollDrafts.organizerShared, true))).groupBy(pollDrafts.threadId),
        tx.select({ threadId: polls.threadId, count: count() }).from(polls).where(inArray(polls.threadId, threadIds)).groupBy(polls.threadId),
        tx.select({ threadId: coordinatorResearchRuns.threadId, count: count() }).from(coordinatorResearchRuns).where(inArray(coordinatorResearchRuns.threadId, threadIds)).groupBy(coordinatorResearchRuns.threadId),
        tx.select({ id: coordinatorThreadIdeas.id, threadId: coordinatorThreadIdeas.threadId, title: itineraryItems.title }).from(coordinatorThreadIdeas).innerJoin(itineraryItems, eq(itineraryItems.id, coordinatorThreadIdeas.itineraryItemId)).where(inArray(coordinatorThreadIdeas.threadId, threadIds)),
      ]) : [[], [], [], [], []] as const;
      const threadDecisionPolls = threadIds.length ? await tx.select({ id: polls.id, threadId: polls.threadId }).from(polls).where(and(inArray(polls.threadId, threadIds))) : [];
      const threadDecisions = threadDecisionPolls.length ? await tx.select({ id: pollDecisions.id, pollId: pollDecisions.pollId, summary: pollDecisions.summary }).from(pollDecisions).where(inArray(pollDecisions.pollId, threadDecisionPolls.map(row => row.id))) : [];

      const travelerFacts = roster.map(member => ({
        id: `traveler:${member.personId}`, version: member.updatedAt.toISOString(), provenance: saved("membership", member.personId), freshness: fresh(member.updatedAt),
        value: { personId: member.personId, name: truncate(member.name, 160), role: member.role, membership: member.status as "active" | "invited", managed: member.accessMode !== "account",
          attendance: member.status === "invited" ? "unknown" as const : member.attendance, attendanceDates: member.attendanceDates ? truncate(member.attendanceDates, 200) : null },
      }));

      const stayFacts = stayRows.map(stay => ({
        id: `stay:${stay.id}`, version: stay.updatedAt.toISOString(), provenance: saved("stay", stay.id, truncate(stay.sourceLabel, 160)), freshness: fresh(stay.updatedAt),
        value: { stayId: stay.id, name: truncate(stay.name, 160), address: truncate(stay.address, 240), startsOn: stay.startsOn, endsOn: stay.endsOn, timezone: stay.timezone, checkInTime: stay.checkInTime, checkOutTime: stay.checkOutTime,
          status: stay.status, bookingReportedByOrganizer: stay.status === "confirmed", availabilityVerified: false as const,
          costCents: stay.totalCents !== null && stay.totalCents >= 0 ? stay.totalCents : null, costKind: stay.totalCents === null ? null : stay.costSource, currency: stay.currency,
          includedPersonIds: included.filter(item => item.stayId === stay.id).map(item => item.personId) },
      }));

      const taskRows = await tx.select().from(tripTasks).where(eq(tripTasks.commonsId, eventId)).orderBy(asc(tripTasks.completed), asc(tripTasks.dueOn)).limit(40);
      const visibleItemIds = new Set([...planRows, ...stayRows, ...travelRows.filter(row => ["arrival", "departure"].includes(row.kind) || row.visibility !== "private")].map(row => row.id));
      const taskFacts = taskRows.filter(row => row.itemKind === null && row.itemId === null || row.itemId !== null && visibleItemIds.has(row.itemId)).map(row => ({ id: `task:${row.id}`, version: row.version, provenance: saved("trip_task", row.id), freshness: fresh(row.updatedAt), value: { taskId: row.id, title: row.title, ownerPersonId: row.ownerPersonId, dueOn: row.dueOn, completed: row.completed, itemKind: row.itemKind, itemId: row.itemId } }));

      const planFacts = planRows.map(item => ({
        id: `plan:${item.id}`, version: item.updatedAt.toISOString(), provenance: saved("itinerary_item", item.id, truncate(item.provenanceLabel, 160)), freshness: fresh(item.updatedAt),
        value: { itemId: item.id, title: truncate(item.title, 200), status: item.status as "idea" | "planned" | "confirmed", scheduledDate: item.scheduledDate, startsAt: iso(item.startsAt), location: item.locationName ? truncate(item.locationName, 240) : null, participantScope: item.audience, sourceUrl: publicActivityWebsite(item.sourceUrl) },
      }));

      const logisticsFacts = travelRows.map(plan => {
        const ids = [...new Set([plan.personId, ...travelParticipants.filter(item => item.planId === plan.id).map(item => item.personId)])].slice(0, 20);
        const endpointZone = plan.kind === "arrival" ? plan.connections?.at(-1)?.arrivalTimezone : plan.connections?.[0]?.departureTimezone;
        const local = endpointZone ? zonedLocalToIso(plan.date, plan.time, endpointZone) : null, returning = plan.returnDate ? zonedLocalToIso(plan.returnDate, plan.returnTime, trip.timezone) : null;
        return { id: `travel:${plan.id}`, version: plan.updatedAt.toISOString(), provenance: saved("travel_plan", plan.id), freshness: fresh(plan.updatedAt),
          value: { travelPlanId: plan.id, travelerIds: ids, kind: truncate(plan.kind, 40), visibility: plan.visibility, status: plan.status as "considering" | "booked" | "confirmed", route: plan.route, date: plan.date, localTime: plan.time, connections: plan.connections,
            arrivesAt: plan.kind === "arrival" ? local : null, departsAt: plan.kind === "departure" ? local : plan.kind === "car_rental" ? returning : null } };
      });

      const pollFacts = pollRows.map(poll => {
        const answers = responses.filter(response => response.pollId === poll.id).map(response => response.answers);
        const resultsVisible = pollResultsAreVisible(poll.ballotMode, poll.status);
        let leadingOption: string | null = null;
        const choice = poll.questions.find(question => question.kind === "choice");
        if (resultsVisible && poll.ballotMode !== "secret" && poll.questions.every(question => question.kind === "choice" || question.kind === "text") && choice && choice.kind === "choice") {
          const tally = choice.options.map(option => ({ label: option.label, votes: answers.filter(set => set.some(answer => answer.questionId === choice.id && answer.optionIds.includes(option.id))).length }))
            .sort((a, b) => b.votes - a.votes);
          if (tally[0] && tally[0].votes > 0 && tally[0].votes > (tally[1]?.votes ?? 0)) leadingOption = truncate(tally[0].label, 240);
        }
        const decision = decisions.find(item => item.pollId === poll.id);
        return { id: `poll:${poll.id}`, version: poll.updatedAt.toISOString(), provenance: { kind: decision ? "approved_decision" as const : "poll_preference" as const, recordType: decision ? "poll_decision" as const : "poll" as const, recordId: decision?.id ?? poll.id, threadId: poll.threadId, label: null }, freshness: fresh(poll.updatedAt),
          value: { pollId: poll.id, title: truncate(poll.title, 240), status: poll.status as "open" | "closed", threadId: poll.threadId, responseCount: answers.length, resultsVisible, leadingOption,
            decision: decision ? { summary: truncate(decision.summary, 500), approvedAt: decision.createdAt.toISOString(), approvedByName: truncate(decision.approvedByName, 160) } : null } };
      });

      const pendingFacts = sharedTurns.flatMap(turn => {
        const workspace = turn.workspace;
        const entries: TripContextSnapshot["pendingProposals"] = [];
        const common = { kind: "pending_proposal" as const, recordType: "proposal" as const, recordId: turn.id, threadId: turn.threadId, label: null };
        if (workspace?.tripProposal?.state === "pending") entries.push({ id: `proposal:${turn.id}:trip`, version: workspace.tripProposal.version, provenance: common, freshness: fresh(turn.createdAt),
          value: { turnId: turn.id, threadId: turn.threadId, kind: "trip_change", summary: `Proposed ${workspace.tripProposal.operations.join(", ")} update, not applied`, baseVersion: workspace.tripProposal.version } });
        if (workspace?.proposal?.state === "pending") entries.push({ id: `proposal:${turn.id}:draft`, version: workspace.proposal.baseVersion, provenance: common, freshness: fresh(turn.createdAt),
          value: { turnId: turn.id, threadId: turn.threadId, kind: "draft_edit", summary: `${workspace.proposal.changes.length} proposed edit${workspace.proposal.changes.length === 1 ? "" : "s"} to a group draft, not applied`, baseVersion: workspace.proposal.baseVersion } });
        return entries;
      }).slice(0, 10);

      const appliedTripChanges = sharedTurns.filter(turn => turn.workspace?.tripProposal?.state === "applied" && turn.threadId);
      const threads: ThreadIndexEntry[] = threadRows.map(row => {
        const outcomes: ThreadIndexEntry["approvedOutcomes"] = [
          ...threadDecisions.filter(item => threadDecisionPolls.find(poll => poll.id === item.pollId)?.threadId === row.id).map(item => ({ kind: "poll_decision" as const, refId: item.id, label: truncate(item.summary, 160) })),
          ...appliedTripChanges.filter(turn => turn.threadId === row.id).map(turn => ({ kind: "applied_trip_change" as const, refId: turn.id, label: truncate(`Applied ${turn.workspace!.tripProposal!.operations.join(", ")} update`, 160) })),
          ...ideaRows.filter(item => item.threadId === row.id).map(item => ({ kind: "linked_idea" as const, refId: item.id, label: truncate(item.title, 160) })),
        ].slice(0, 8);
        return { threadId: row.id, title: truncate(row.title, 120), status: row.status, summary: meta.get(row.id)?.state?.summary ?? null, summaryTurnVersion: meta.get(row.id)?.state?.summaryTurnVersion ?? null,
          turnVersion: versionRows.find(item => item.threadId === row.id)?.version ?? 0, openQuestions: (meta.get(row.id)?.state?.openQuestions ?? []).slice(0, 3), approvedOutcomes: outcomes,
          artifactCounts: { drafts: draftRows.find(item => item.threadId === row.id)?.count ?? 0, polls: threadPolls.find(item => item.threadId === row.id)?.count ?? 0,
            research: researchRows.find(item => item.threadId === row.id)?.count ?? 0, linkedIdeas: ideaRows.filter(item => item.threadId === row.id).length }, lastActivityAt: row.updatedAt.toISOString() };
      });

      const unknowns: TripContextSnapshot["unknowns"] = [];
      if (!trip.startsOn || !trip.endsOn) unknowns.push("dates");
      if (!trip.locationName) unknowns.push("destination");
      if (!stayRows.length) unknowns.push("stay");
      if (trip.targetBudgetCents === null) unknowns.push("budget");
      if (!roster.some(member => member.status === "active" && member.attendance === "attending")) unknowns.push("attendance");
      if (!planRows.length) unknowns.push("plans");
      if (!travelRows.length) unknowns.push("travel_logistics");

      return TripContextSnapshotSchema.parse({
        schemaVersion: 1, tripId: eventId, assembledAt: asOf, audience: "active_organizers",
        trip: { id: "trip", version: trip.updatedAt.toISOString(), provenance: saved("trip", eventId), freshness: fresh(trip.updatedAt),
          value: { name: truncate(trip.name, 200), destination: trip.locationName ? truncate(trip.locationName, 160) : null, startsOn: trip.startsOn, endsOn: trip.endsOn, timezone: trip.timezone, currency: trip.currency, planningPreferences: readTripPlanningBrief(trip.eventBrief) } },
        travelers: travelerFacts, stays: stayFacts, plans: planFacts, logistics: logisticsFacts, tasks: taskFacts,
        budget: { id: "budget", version: createHash("sha256").update(JSON.stringify([trip.targetBudgetCents, trip.targetBudgetCurrency, expenseCurrencyTotals])).digest("hex"), provenance: saved("budget", eventId), freshness: fresh(trip.updatedAt),
          value: { targetTotalCents: trip.targetBudgetCents, recordedExpenseTotalCents: expenseTotals.total, recordedExpenseCount: expenseTotals.count, currency: trip.targetBudgetCurrency, recordedByCurrency: expenseCurrencyTotals.map(row => ({ currency: row.currency, totalCents: row.total, count: row.count })) } },
        polls: pollFacts, foodPreferences: await readFoodPlanningContext(tx, eventId, asOf), pendingProposals: pendingFacts, threads, capabilities: options.capabilities ?? ["answer"], unknowns,
        itineraryAnchors: await loadSavedItineraryAnchors(tx, trip),
      });
}


export type ThreadExcerpt = { threadId: string; title: string; status: "active" | "archived"; turns: Array<{ turnId: string; userText: string; assistantText: string }> };

/**
 * On-demand read of another organizer thread (design §7.3). Attributed to its thread by the caller and never
 * promoted to a trip fact. Only completed, organizer-shared turns of a thread in THIS trip are readable, so
 * legacy owner-private turns, failed or pending attempts, and other trips' threads can never appear here.
 * Bounded: the most recent `maxTurns` turns, `maxChars` characters in total.
 */
export async function readThreadExcerpt(identifier: string, threadId: string, options: PollRepositoryOptions & { maxTurns?: number; maxChars?: number }): Promise<ThreadExcerpt> {
  const maxTurns = Math.min(options.maxTurns ?? 6, 6), maxChars = Math.min(options.maxChars ?? 2_400, 2_400);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const eventId = await requireTripOrganizer(tx, identifier, options.actorPersonId, false);
      const [thread] = await tx.select({ id: coordinatorThreads.id, title: coordinatorThreads.title, status: coordinatorThreads.status }).from(coordinatorThreads)
        .where(and(eq(coordinatorThreads.id, threadId), eq(coordinatorThreads.commonsId, eventId))).limit(1);
      if (!thread) throw new CoordinatorTurnError("thread_unavailable");
      const rows = await tx.select({ id: coordinatorTurns.id, userText: coordinatorTurns.userText, assistantText: coordinatorTurns.assistantText }).from(coordinatorTurns)
        .where(and(eq(coordinatorTurns.threadId, thread.id), eq(coordinatorTurns.commonsId, eventId), eq(coordinatorTurns.organizerShared, true), turnIsCompletedSql))
        .orderBy(desc(coordinatorTurns.sequence)).limit(maxTurns);
      // Newest first while filling the budget, so the most recent discussion survives truncation.
      const perTurn = Math.max(80, Math.floor(maxChars / Math.max(1, rows.length) / 2));
      let used = 0;
      const kept: ThreadExcerpt["turns"] = [];
      for (const row of rows) {
        const userText = truncate(row.userText, perTurn), assistantText = truncate(row.assistantText, perTurn);
        if (used + userText.length + assistantText.length > maxChars) break;
        used += userText.length + assistantText.length;
        kept.unshift({ turnId: row.id, userText, assistantText });
      }
      return { threadId: thread.id, title: truncate(thread.title, 120), status: thread.status, turns: kept };
    });
  } finally { await database.close(); }
}
