import { CommandConflictError } from "./event-command";
import { UpdateMoneySettingsCommandSchema } from "@commons/contracts";
import { consumeConfirmationIntake } from "./confirmation-intake-repository";
import {
    AddItineraryItemCommandSchema,
    itineraryDurationMinutes,
    itineraryEndTime,
    AddMomentCommandSchema,
    AddStayCommandSchema,
    SetPlacePinCommandSchema,
    AddExpenseCommandSchema,
    AddReimbursementCommandSchema, CommonsSnapshotSchema,
    ConfirmExpensesCompleteCommandSchema,
    DeleteItineraryItemCommandSchema,
    DeleteMomentRequestSchema,
    DeleteExpenseCommandSchema,
    DeleteReimbursementCommandSchema,
    DeleteStayCommandSchema,
    DeleteTravelPlanCommandSchema,
    ProposalSchema,
    ReopenExpensesCommandSchema, UpdateCommonsCoverRequestSchema,
    UpdateCommonsArchiveRequestSchema,
    UpdateCommonsTitleRequestSchema,
    UpdateCommonsDetailsRequestSchema,
    TripLetterSectionsSchema,
    UpdateTripLetterRequestSchema,
    UpdateExpenseCommandSchema,
    UpdateReimbursementCommandSchema,
    UpdateItineraryItemCommandSchema,
    UpdateMomentRequestSchema,
    UpdateStayCommandSchema,
    UpdateTravelPlanSharingCommandSchema,
    UpdateParticipationCommandSchema,
    UpsertTravelPlanCommandSchema,
    UpsertFlightBookingCommandSchema,
    UpdateTargetBudgetCommandSchema,
    type Actor,
    type PlacePin,
    type CommonsSnapshot,
    type CommonsState,
    type Proposal
} from "@commons/contracts";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { runEventCommand, type CommandTransaction } from "./event-command";
import { isCommonsId } from "./commons-identifier";
import { tripStage } from "./trip-stage-repository";
import {
    auditEvents,
    commons,
    confirmationDocuments,
    expenseShares,
    expenses,
    identities,
    itineraryItems,
    mealReservations,
    memberships,
    messages,
    moments,
    participation,
    photoDeletions,
    people,
    travelerProfiles,
    polls,
    pollDrafts,
    pollResponses,
    processedCommands,
    proposalEvidence,
    proposals,
    reimbursements,
    stayParticipants,
    stays as stayRecords,
    travelPlanParticipants,
    travelPlans,
} from "./schema";

export type PilotRepositoryOptions = {
  databaseUrl?: string;
  actorPersonId: string;
};

export class CommonsRepositoryError extends Error {
  constructor(
    public readonly code:
      | "commons_not_found"
      | "actor_not_found"
      | "actor_not_authorized"
      | "expense_not_found"
      | "reimbursement_not_found"
      | "expense_ledger_closed"
      | "itinerary_not_found"
      | "itinerary_conflict"
      | "moment_not_found"
      | "stay_not_found"
      | "travel_plan_not_found"
      | "travel_plan_conflict"
      | "proposal_not_found"
      | "proposal_conflict"
      | "letter_conflict",
    message: string,
  ) {
    super(message);
    this.name = "CommonsRepositoryError";
  }
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertConfirmationDocumentPath(slug: string, ownerPersonId: string, storagePath: string) {
  if (!new RegExp(`^${escapeRegularExpression(slug)}/${escapeRegularExpression(ownerPersonId)}/(?:[0-9a-f-]{36}|[0-9a-f]{64})\\.(?:pdf|png|jpg|webp|txt|eml)$`, "i").test(storagePath)) {
    throw new CommonsRepositoryError("actor_not_authorized", "That confirmation upload does not belong to this trip.");
  }
}

export function assertExpenseLedgerOpen(expensesClosedAt: Date | null | undefined) {
  if (expensesClosedAt) {
    throw new CommonsRepositoryError(
      "expense_ledger_closed",
      "An organizer closed expenses for this trip. Reopen expenses before changing money records.",
    );
  }
}

function assertExpenseBalanceMode(
  balancesDisabled: boolean | null | undefined,
  balanceMode: "allocated" | "tracking_only" | "budget_only",
) {
  if (balancesDisabled && balanceMode === "allocated") {
    throw new CommonsRepositoryError(
      "actor_not_authorized",
      "This family trip records spending without allocating balances. Choose tracking only or budget only.",
    );
  }
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function localDateTimeToDate(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(guess));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(
    parts.find((part) => part.type === type)?.value ?? 0,
  );
  const representedAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
  );
  return new Date(guess - (representedAsUtc - guess));
}

function initials(displayName: string) {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function identityState(
  authUserId: string | null,
  states: Array<"observed" | "channel_verified" | "claimed">,
): Actor["identityState"] {
  if (authUserId || states.includes("claimed")) return "claimed";
  if (states.includes("channel_verified")) return "channel_verified";
  return "observed";
}

function participantScope(
  scope: "everyone" | "subgroup" | "individual",
): "everyone" | "subgroup" | "optional" {
  return scope === "individual" ? "optional" : scope;
}

async function readSnapshot(
  database: ReturnType<typeof createDatabase>, identifier: string, actorPersonId: string,
): Promise<CommonsSnapshot | null> {
  return database.db.transaction(
    (tx) => readSnapshotRows({ db: tx }, identifier, actorPersonId),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function readSnapshotRows(
  database: { db: CommandTransaction },
  identifier: string,
  actorPersonId: string,
): Promise<CommonsSnapshot | null> {
  const [commonsRecord] = await database.db
    .select()
    .from(commons)
    .where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier))
    .limit(1);

  if (!commonsRecord) return null;

  const memberRows = await database.db
    .select({
      personId: people.id,
      displayName: people.displayName,
      avatarUrl: people.avatarUrl,
      authUserId: people.authUserId,
      role: memberships.role,
      status: memberships.status,
      expensesCompleteAt: memberships.expensesCompleteAt,
      accessMode: memberships.accessMode,
      managedByPersonIds: memberships.managedByPersonIds,
      canClaimAccess: memberships.canClaimAccess,
      sharedPreferenceKeys: memberships.sharedPreferenceKeys,
      usualOriginLabel: travelerProfiles.usualOriginLabel,
      dietaryPreferences: travelerProfiles.dietaryPreferences,
      accessibilityNeeds: travelerProfiles.accessibilityNeeds,
      lodgingPreferences: travelerProfiles.lodgingPreferences,
      transportationPreferences: travelerProfiles.transportationPreferences,
    })
    .from(memberships)
    .innerJoin(people, eq(memberships.personId, people.id))
    .leftJoin(travelerProfiles, eq(travelerProfiles.personId, people.id))
    .where(eq(memberships.commonsId, commonsRecord.id))
    .orderBy(asc(memberships.createdAt));

  const actorRow = memberRows.find(
    (member) => member.personId === actorPersonId && member.status === "active",
  );
  if (!actorRow) {
    throw new CommonsRepositoryError(
      "actor_not_found",
      "The active pilot participant is not a member of this Commons.",
    );
  }

  const identityRows = await database.db
    .select({ state: identities.state })
    .from(identities)
    .where(eq(identities.personId, actorRow.personId));

  const activeMembers = memberRows.filter((member) => member.status === "active");
  const visibleMembers = memberRows.filter(
    (member) => member.status === "active" || member.status === "invited",
  );
  const activePersonIds = activeMembers.map((member) => member.personId);
  const actor: Actor = {
    id: actorRow.personId,
    displayName: actorRow.displayName,
    role: actorRow.role,
    identityState: identityState(
      actorRow.authUserId,
      identityRows.map((identity) => identity.state),
    ),
  };

  const [
    messageRows,
    proposalRows,
    itineraryRows,
    auditRows,
    commandRows,
    expenseRows,
    expenseShareRows,
    reimbursementRows,
    travelPlanRows,
    travelPlanParticipantRows,
    stayRows,
    stayParticipantRows,
    momentRows,
    confirmationDocumentRows,
  ] =
    await Promise.all([
      database.db
        .select()
        .from(messages)
        .where(eq(messages.commonsId, commonsRecord.id))
        .orderBy(asc(messages.sequence)),
      database.db
        .select()
        .from(proposals)
        .where(eq(proposals.commonsId, commonsRecord.id))
        .orderBy(asc(proposals.createdAt)),
      database.db
        .select()
        .from(itineraryItems)
        .where(eq(itineraryItems.commonsId, commonsRecord.id))
        .orderBy(asc(itineraryItems.startsAt)),
      database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.commonsId, commonsRecord.id))
        .orderBy(asc(auditEvents.occurredAt)),
      database.db
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(eq(processedCommands.commonsId, commonsRecord.id)),
      database.db
        .select()
        .from(expenses)
        .where(eq(expenses.commonsId, commonsRecord.id))
        .orderBy(desc(expenses.occurredOn), desc(expenses.createdAt)),
      database.db
        .select({
          expenseId: expenseShares.expenseId,
          personId: expenseShares.personId,
          amountCents: expenseShares.amountCents,
        })
        .from(expenseShares)
        .innerJoin(expenses, eq(expenseShares.expenseId, expenses.id))
        .where(eq(expenses.commonsId, commonsRecord.id)),
      database.db
        .select()
        .from(reimbursements)
        .where(eq(reimbursements.commonsId, commonsRecord.id))
        .orderBy(desc(reimbursements.occurredOn), desc(reimbursements.createdAt)),
      database.db
        .select()
        .from(travelPlans)
        .where(eq(travelPlans.commonsId, commonsRecord.id))
        .orderBy(asc(travelPlans.date), asc(travelPlans.time)),
      database.db
        .select({
          travelPlanId: travelPlanParticipants.travelPlanId,
          personId: travelPlanParticipants.personId,
        })
        .from(travelPlanParticipants)
        .innerJoin(travelPlans, eq(travelPlanParticipants.travelPlanId, travelPlans.id))
        .where(eq(travelPlans.commonsId, commonsRecord.id)),
      database.db
        .select()
        .from(stayRecords)
        .where(eq(stayRecords.commonsId, commonsRecord.id))
        .orderBy(asc(stayRecords.startsOn), asc(stayRecords.createdAt)),
      database.db
        .select({
          stayId: stayParticipants.stayId,
          personId: stayParticipants.personId,
        })
        .from(stayParticipants)
        .innerJoin(stayRecords, eq(stayParticipants.stayId, stayRecords.id))
        .where(eq(stayRecords.commonsId, commonsRecord.id)),
      database.db
        .select()
        .from(moments)
        .where(eq(moments.commonsId, commonsRecord.id))
        .orderBy(asc(moments.occurredAt), asc(moments.createdAt)),
      database.db
        .select()
        .from(confirmationDocuments)
        .where(and(
          eq(confirmationDocuments.commonsId, commonsRecord.id),
          eq(confirmationDocuments.ownerPersonId, actor.id),
        )),
    ]);

  const memberNames = new Map(
    memberRows.map((member) => [member.personId, member.displayName]),
  );

  const evidenceRows = proposalRows.length
    ? await database.db
        .select({
          proposalId: proposalEvidence.proposalId,
          messageId: proposalEvidence.messageId,
          excerpt: proposalEvidence.excerpt,
          actorName: messages.actorName,
          occurredAt: messages.occurredAt,
        })
        .from(proposalEvidence)
        .innerJoin(messages, eq(proposalEvidence.messageId, messages.id))
        .where(inArray(proposalEvidence.proposalId, proposalRows.map((proposal) => proposal.id)))
        .orderBy(asc(messages.sequence))
    : [];

  const privateMealRows = itineraryRows.length ? await database.db.select().from(mealReservations).where(and(
    eq(mealReservations.personId, actorPersonId), inArray(mealReservations.itineraryItemId, itineraryRows.map(item => item.id)),
  )) : [];
  const privateMeals = new Map(privateMealRows.map(row => [row.itineraryItemId, { number: row.confirmationNumber, note: row.note }]));
  const participationRows = itineraryRows.length
    ? await database.db
        .select({
          itineraryItemId: participation.itineraryItemId,
          personId: participation.personId,
          status: participation.status,
          source: participation.source,
        })
        .from(participation)
        .where(
          inArray(
            participation.itineraryItemId,
            itineraryRows.map((item) => item.id),
          ),
        )
    : [];

  const legacyStayByExpenseId = new Map(stayRows.flatMap((stay) =>
    stay.legacyExpenseId ? [[stay.legacyExpenseId, stay.id] as const] : [],
  ));
  const legacyTravelByExpenseId = new Map(travelPlanRows.flatMap((plan) =>
    plan.legacyExpenseId ? [[plan.legacyExpenseId, plan.id] as const] : [],
  ));
  const confirmationByStayId = new Map(confirmationDocumentRows.flatMap((document) => document.stayId ? [[document.stayId, document] as const] : []));
  const confirmationByTravelId = new Map(confirmationDocumentRows.flatMap((document) => document.travelPlanId ? [[document.travelPlanId, document] as const] : []));
  const confirmationByExpenseId = new Map(confirmationDocumentRows.flatMap((document) => document.expenseId ? [[document.expenseId, document] as const] : []));
  const stays = stayRows.map((stay) => ({
    id: stay.id,
    name: stay.name,
    address: stay.address,
    pin: savedPlacePin(stay),
    startsOn: stay.startsOn,
    endsOn: stay.endsOn,
    timezone: stay.timezone ?? undefined,
    checkInTime: stay.checkInTime ?? undefined,
    checkOutTime: stay.checkOutTime ?? undefined,
    status: stay.status,
    includedPersonIds: stayParticipantRows
      .filter((participant) => participant.stayId === stay.id)
      .map((participant) => participant.personId),
    bookingUrl: stay.bookingUrl ?? undefined,
    pollId: stay.pollId ?? undefined,
    confirmationCode: stay.confirmationCode ?? undefined,
    totalCents: stay.totalCents ?? undefined,
    roomPriceCents: stay.roomPriceCents ?? undefined,
    roomCount: stay.roomCount ?? undefined,
    currency: stay.totalCents || stay.roomPriceCents ? stay.currency : undefined,
    costSource: stay.costSource ?? undefined,
    includesTaxesAndFees: stay.includesTaxesAndFees ?? undefined,
    details: stay.details ?? undefined,
    sourceLabel: stay.sourceLabel,
    confirmationDocumentFileName: confirmationByStayId.get(stay.id)?.fileName,
    confirmationDocumentUrl: confirmationByStayId.has(stay.id) ? `/api/v1/commons/${commonsRecord.slug}/confirmations/stay/${stay.id}` : undefined,
  })).sort((first, second) => {
    const rank = { confirmed: 0, planned: 1, considering: 2 } as const;
    return rank[first.status] - rank[second.status] || first.startsOn.localeCompare(second.startsOn);
  });
  const primaryStay = stays.find((stay) => stay.status === "confirmed")
    ?? stays.find((stay) => stay.status === "planned");
  const participantIdsByTravelPlan = new Map<string, string[]>();
  travelPlanParticipantRows.forEach((participant) => {
    participantIdsByTravelPlan.set(participant.travelPlanId, [
      ...(participantIdsByTravelPlan.get(participant.travelPlanId) ?? []),
      participant.personId,
    ]);
  });
  const travelPlanPersonIds = (plan: typeof travelPlanRows[number]) => participantIdsByTravelPlan.get(plan.id)
    ?? [plan.personId, ...(plan.companionPersonId ? [plan.companionPersonId] : [])];
  const ownsTravelPlan = (plan: typeof travelPlanRows[number]) => plan.personId === actor.id || travelPlanPersonIds(plan).includes(actor.id);
  const normalizedTravelVisibility = (visibility: string) => visibility === "group" ? "basic" : visibility;
  const visibleTravelPlanRows = travelPlanRows.filter((plan) =>
    ["arrival", "departure"].includes(plan.kind) || ownsTravelPlan(plan) || normalizedTravelVisibility(plan.visibility) !== "private",
  );
  const visibleTravelPlanIds = new Set(visibleTravelPlanRows.map((plan) => plan.id));

  const state: CommonsState = {
    commonsId: commonsRecord.id,
    // A linked request is a projection of the canonical poll, not a duplicate
    // message. Filter before serialization so subset asks stay subset-scoped.
    pollRequests: (await database.db.select({ id: polls.id, publicId: polls.publicId, title: polls.title, status: polls.status,
      itinerary: sql<boolean>`exists (select 1 from jsonb_array_elements(${polls.questions}) question where question->>'kind' = 'choice' and question->'itinerary' is not null)`,
      // Qualify the outer id explicitly: Drizzle's single-table projection
      // otherwise strips the column's table and binds "id" to the inner row.
      superseded: sql<boolean>`exists (select 1 from ${pollDrafts} where ${pollDrafts.publishedPollId} = ${polls}.${sql.identifier(polls.id.name)} and ${pollDrafts.data}->'lifecycle'->>'replacementDraftId' is not null)`,
      canManage: sql<boolean>`${actorRow.role === "organizer"} or ${polls.createdByPersonId} = ${actor.id}`,
      responded: sql<boolean>`exists (select 1 from ${pollResponses} where ${pollResponses.pollId} = ${polls}.${sql.identifier(polls.id.name)} and (${pollResponses.respondentPersonId} = ${actor.id} or ${pollResponses.respondentAuthUserId} = ${actorRow.authUserId}))`,
    }).from(polls).where(and(eq(polls.commonsId, commonsRecord.id), sql`${polls.status} <> 'revoked'`,
      sql`(${polls.audience} is null or ${actorRow.role === "organizer"} or ${polls.createdByPersonId} = ${actor.id} or ${polls.audience}->'personIds' @> ${JSON.stringify([actor.id])}::jsonb)`))
      .orderBy(desc(polls.createdAt)).limit(20)).map(row => ({ ...row, status: row.status === "open" ? "open" as const : "closed" as const })),
    targetBudgetCurrency: commonsRecord.targetBudgetCurrency,
    targetBudgetCents: commonsRecord.targetBudgetCents ?? undefined,
    messages: messageRows.map((message) => ({
      id: message.id,
      actorId: message.actorPersonId ?? message.actorType,
      actorName: message.actorName,
      actorType: message.actorType === "human" ? "human" : "commons",
      body: message.body,
      occurredAt: iso(message.occurredAt),
      source: message.source,
    })),
    proposals: proposalRows.map((proposal): Proposal =>
      ProposalSchema.parse({
        id: proposal.id,
        commonsId: proposal.commonsId,
        version: proposal.version,
        status: proposal.status,
        title: proposal.title,
        summary: proposal.summary,
        affectedPersonIds: activePersonIds,
        createdAt: iso(proposal.createdAt),
        expiresAt: iso(proposal.expiresAt),
        evidence: evidenceRows
          .filter((evidence) => evidence.proposalId === proposal.id)
          .map((evidence) => ({
            messageId: evidence.messageId,
            excerpt: evidence.excerpt,
            actorName: evidence.actorName,
            occurredAt: iso(evidence.occurredAt),
          })),
        payload: proposal.payload,
        approvedBy: proposal.approvedByPersonId ?? undefined,
        approvedAt: proposal.approvedAt ? iso(proposal.approvedAt) : undefined,
      }),
    ),
    itinerary: itineraryRows.map((item) => ({
      id: item.id,
      arrangerPersonId: item.arrangerPersonId ?? undefined,
      arrangerName: item.arrangerPersonId ? memberRows.find((member) => member.personId === item.arrangerPersonId)?.displayName ?? "Previous participant" : undefined,
      arrangerActive: item.arrangerPersonId ? activeMembers.some((member) => member.personId === item.arrangerPersonId && member.accessMode === "account") : undefined,
      proposalId: item.sourceProposalId ?? undefined,
      title: item.title,
      startsAt: item.startsAt ? iso(item.startsAt) : null,
      scheduledDate: item.scheduledDate,
      endsAt: item.endsAt ? iso(item.endsAt) : undefined,
      durationMinutes: item.durationMinutes,
      location: item.locationName ?? undefined,
      pin: savedPlacePin(item),
      participantScope: participantScope(item.audience),
      respondedParticipantIds: participationRows
        .filter((entry) => entry.itineraryItemId === item.id && entry.source !== "plan_estimate" && entry.status !== "skip" && activeMembers.some((member) => member.personId === entry.personId))
        .map((entry) => entry.personId),
      participantIds: participationRows
        .filter(
          (entry) =>
            entry.itineraryItemId === item.id && entry.status === "in",
        )
        .map((entry) => entry.personId),
      status: item.status,
      expectedCostCurrency: item.expectedCostCurrency,
      expectedCostCents: item.expectedCostCents ?? undefined,
      expectedCostBasis: item.expectedCostBasis,
      expectedParticipantIds: participationRows
        .filter((entry) => entry.itineraryItemId === item.id && entry.status !== "skip")
        .map((entry) => entry.personId),
      note: item.note ?? undefined,
      sourceUrl: item.sourceUrl ?? undefined,
      mealType: item.mealType ?? undefined,
      mealReservation: privateMeals.get(item.id),
      provenanceLabel: item.provenanceLabel,
      version: iso(item.updatedAt),
    })),
    auditEvents: auditRows.filter((event) =>
      event.resourceType !== "travel_plan" ||
      (event.resourceId !== null && visibleTravelPlanIds.has(event.resourceId)),
    ).map((event) => ({
      id: event.id,
      commandId: event.commandId,
      actorId: event.actorId,
      action: event.action,
      targetId: event.resourceId,
      occurredAt: iso(event.occurredAt),
      summary: event.summary,
    })),
    processedCommandIds: commandRows.map((command) => command.commandId),
    participation: Object.fromEntries(
      participationRows
        .filter((entry) => entry.personId === actor.id && entry.source !== "plan_estimate")
        .map((entry) => [entry.itineraryItemId, entry.status]),
    ),
    expenses: expenseRows.map((expense) => ({
      id: expense.id,
      title: expense.title,
      amountCents: expense.amountCents,
      currency: expense.currency,
      paidByPersonId: expense.paidByPersonId,
      paidByName: memberNames.get(expense.paidByPersonId) ?? "Unknown participant",
      occurredOn: expense.occurredOn,
      category: expense.category,
      status: expense.status,
      splitMethod: expense.splitMethod,
      balanceMode: expense.balanceMode === "budget_only"
        ? "budget_only" as const
        : expense.balanceMode === "tracking_only" ? "tracking_only" as const : "allocated" as const,
      confirmationCode: expense.confirmationCode ?? undefined,
      receiptStatus: expense.receiptStatus,
      itineraryItemId: expense.itineraryItemId ?? undefined,
      stayId: legacyStayByExpenseId.get(expense.id) ?? undefined,
      travelPlanId: legacyTravelByExpenseId.get(expense.id) ?? undefined,
      sourceLabel: expense.sourceLabel,
      receiptFileName: confirmationByExpenseId.get(expense.id)?.fileName,
      receiptUrl: confirmationByExpenseId.has(expense.id) ? `/api/v1/commons/${commonsRecord.slug}/confirmations/expense/${expense.id}` : undefined,
      note: expense.note ?? undefined,
      shares: expenseShareRows
        .filter((share) => share.expenseId === expense.id)
        .map((share) => ({
          personId: share.personId,
          amountCents: share.amountCents,
        })),
    })),
    reimbursements: reimbursementRows.map((reimbursement) => ({
      id: reimbursement.id,
      fromPersonId: reimbursement.fromPersonId,
      fromPersonName:
        memberNames.get(reimbursement.fromPersonId) ?? "Unknown participant",
      toPersonId: reimbursement.toPersonId,
      toPersonName:
        memberNames.get(reimbursement.toPersonId) ?? "Unknown participant",
      amountCents: reimbursement.amountCents,
      currency: reimbursement.currency,
      occurredOn: reimbursement.occurredOn,
      sourceLabel: reimbursement.sourceLabel,
    })),
    travelPlans: visibleTravelPlanRows.map((plan) => {
      const ownsPlan = ownsTravelPlan(plan);
      const flight = ["arrival", "departure"].includes(plan.kind);
      const visibility = (flight ? "basic" : normalizedTravelVisibility(plan.visibility)) as "private" | "basic" | "all";
      const canSeeAllSharedDetails = ownsPlan || visibility === "all";
      const planPersonIds = travelPlanPersonIds(plan);
      const travelerNames = planPersonIds.map((personId) => memberNames.get(personId) ?? "Participant");
      return {
        id: plan.id,
        version: iso(plan.updatedAt),
        connections: flight || ownsPlan ? plan.connections : undefined,
        personId: plan.personId,
        personIds: planPersonIds,
        personName: travelerNames.length > 1
          ? travelerNames.map((name) => name.split(" ")[0]).join(" + ")
          : travelerNames[0] ?? "Participant",
        kind: plan.kind === "transport" ? "transport" as const : plan.kind === "departure" ? "departure" as const : plan.kind === "car_rental" ? "car_rental" as const : "arrival" as const,
        date: plan.date,
        route: plan.route,
        time: plan.time ?? undefined,
        driverPersonId: plan.driverPersonId ?? undefined,
        driverName: plan.driverPersonId ? memberNames.get(plan.driverPersonId) ?? "Traveler" : undefined,
        provider: plan.provider || undefined,
        vehicle: plan.vehicle || undefined,
        returnDate: plan.returnDate ?? undefined,
        returnTime: plan.returnTime ?? undefined,
        status: plan.status === "considering" ? "considering" as const : plan.status === "booked" ? "booked" as const : "confirmed" as const,
        note: canSeeAllSharedDetails ? plan.note ?? "" : "",
        visibility,
        confirmationCode: ownsPlan ? plan.confirmationCode ?? undefined : undefined,
        totalCents: !flight && canSeeAllSharedDetails ? plan.totalCents ?? undefined : undefined,
        currency: !flight && canSeeAllSharedDetails && plan.totalCents ? plan.currency : undefined,
        sourceLabel: plan.sourceLabel,
        confirmationDocumentFileName: ownsPlan ? confirmationByTravelId.get(plan.id)?.fileName : undefined,
        confirmationDocumentUrl: ownsPlan && confirmationByTravelId.has(plan.id) ? `/api/v1/commons/${commonsRecord.slug}/confirmations/travel/${plan.id}` : undefined,
      };
    }),
    stays,
    moments: momentRows.map((moment) => ({
      id: moment.id,
      kind: "photo" as const,
      assetUrl: `/api/v1/commons/${commonsRecord.slug}/moments/${moment.id}`,
      caption: moment.caption,
      altText: moment.altText,
      occurredAt: iso(moment.occurredAt),
      dateStatus: moment.dateStatus === "unconfirmed" ? "unconfirmed" as const : "confirmed" as const,
      addedByPersonId: moment.addedByPersonId ?? undefined,
      addedByName: moment.addedByPersonId
        ? memberNames.get(moment.addedByPersonId)
        : undefined,
      sourceLabel: moment.sourceLabel,
      itineraryItemId: moment.itineraryItemId ?? undefined,
      itineraryItemTitle: moment.itineraryItemId
        ? itineraryRows.find((item) => item.id === moment.itineraryItemId)?.title
        : undefined,
      eventMatch: moment.eventMatchSource && moment.eventMatchConfidence !== null && moment.eventMatchReason
        ? {
            source: moment.eventMatchSource === "manual" ? "manual" as const : "automatic" as const,
            confidence: moment.eventMatchConfidence,
            reason: moment.eventMatchReason,
          }
        : undefined,
    })),
  };

  return CommonsSnapshotSchema.parse({
    commons: {
      id: commonsRecord.id,
      slug: commonsRecord.slug,
      name: commonsRecord.name,
      startsOn: commonsRecord.startsOn,
      endsOn: commonsRecord.endsOn,
      locationName: commonsRecord.locationName,
      locationNames: commonsRecord.locationNames.length
        ? commonsRecord.locationNames
        : commonsRecord.locationName ? [commonsRecord.locationName] : [],
      currency: commonsRecord.currency,
      balancesDisabled: commonsRecord.balancesDisabled,
      timezone: commonsRecord.timezone,
      status: commonsRecord.status,
      coverImageUrl: commonsRecord.coverImageUrl,
      coverCardImageUrl: commonsRecord.coverCardImageUrl,
      coverSourceMomentId: commonsRecord.coverSourceMomentId,
      welcomeMessage: commonsRecord.welcomeMessage,
      welcomeAuthorPersonId: commonsRecord.welcomeAuthorPersonId,
      letterSections: TripLetterSectionsSchema.nullable().catch(null).parse(commonsRecord.letterSections ?? null),
      templateKey: commonsRecord.templateKey ?? null,
      stage: tripStage(commonsRecord),
      expensesClosedAt: commonsRecord.expensesClosedAt ? iso(commonsRecord.expensesClosedAt) : null,
      expensesClosedByPersonId: commonsRecord.expensesClosedByPersonId,
      expensesClosedByName: commonsRecord.expensesClosedByPersonId
        ? memberNames.get(commonsRecord.expensesClosedByPersonId) ?? "An organizer"
        : null,
      lodging: primaryStay ? {
        name: primaryStay.name,
        address: primaryStay.address,
        sourceLabel: primaryStay.sourceLabel,
      } : null,
    },
    currentActor: actor,
    participants: visibleMembers.map((member) => ({
      id: member.personId,
      displayName: member.displayName,
      initials: initials(member.displayName),
      role: member.role,
      membershipStatus: member.status,
      accessMode: member.accessMode === "managed" ? "managed" : "account",
      managedByPersonIds: member.accessMode === "managed" ? member.managedByPersonIds ?? undefined : undefined,
      canClaimAccess: member.accessMode === "managed" ? member.canClaimAccess : undefined,
      avatarUrl: member.avatarUrl,
      expensesCompleteAt: member.expensesCompleteAt ? iso(member.expensesCompleteAt) : null,
      sharedPreferences: Object.fromEntries(member.sharedPreferenceKeys.flatMap((key) => {
        const value = member[key as keyof typeof member];
        return typeof value === "string" && value ? [[key, value]] : [];
      })),
    })),
    state,
  });
}

export async function updateCommonsTargetBudget(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = UpdateTargetBudgetCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction((tx) => runEventCommand(tx, {
      identifier: slug, actorPersonId: options.actorPersonId,
      commandId: command.commandId, action: "budget.target_updated", input: command,
    }, (context) => {
      if (context.role !== "organizer") throw new CommonsRepositoryError("actor_not_authorized", "Only an organizer can set the target trip budget.");
    }, async (context) => {
      const [trip] = await tx.select().from(commons).where(eq(commons.id, context.id));
      const currency = command.currency ?? (trip.targetBudgetCents !== null ? trip.targetBudgetCurrency : trip.currency);
      await tx.update(commons).set({ targetBudgetCents: command.amountCents, targetBudgetCurrency: currency, updatedAt: context.now })
        .where(eq(commons.id, context.id));
      return { result: { amountCents: command.amountCents }, resourceType: "commons", resourceId: context.id,
        summary: command.amountCents === null ? "Target trip budget removed." : "Target trip budget updated." };
    }));
    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

function restoredCommonsStatus(
  startsOn: string | null,
  endsOn: string | null,
  timeZone: string,
  now = new Date(),
) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  if (endsOn && endsOn < today) return "closing" as const;
  if (startsOn && startsOn <= today && (!endsOn || endsOn >= today)) {
    return "active" as const;
  }
  return "planning" as const;
}

export async function updateCommonsArchived(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = UpdateCommonsArchiveRequestSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      const [lockedCommons] = await transaction
        .select({
          id: commons.id,
          name: commons.name,
          startsOn: commons.startsOn,
          endsOn: commons.endsOn,
          timezone: commons.timezone,
          status: commons.status,
        })
        .from(commons)
        .where(eq(commons.id, commonsRecord.id))
        .for("update")
        .limit(1);
      if (!lockedCommons) {
        throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
      }

      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, lockedCommons.id),
          eq(processedCommands.commandId, command.commandId),
        ))
        .limit(1);
      if (alreadyProcessed) return;

      const [actorRow] = await transaction
        .select({
          personId: people.id,
          displayName: people.displayName,
          status: memberships.status,
          role: memberships.role,
        })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(and(
          eq(memberships.commonsId, lockedCommons.id),
          eq(memberships.personId, options.actorPersonId),
        ))
        .limit(1);
      if (!actorRow || actorRow.status !== "active" || actorRow.role !== "organizer") {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "Only an organizer can archive or restore this trip.",
        );
      }

      const nextStatus = command.archived
        ? "archived"
        : lockedCommons.status === "archived"
          ? restoredCommonsStatus(lockedCommons.startsOn, lockedCommons.endsOn, lockedCommons.timezone)
          : lockedCommons.status;
      const changed = nextStatus !== lockedCommons.status;
      const changedAt = new Date();

      if (changed) {
        await transaction
          .update(commons)
          .set({ status: nextStatus, updatedAt: changedAt })
          .where(eq(commons.id, lockedCommons.id));
      }
      await transaction.insert(processedCommands).values({
        commonsId: lockedCommons.id,
        commandId: command.commandId,
        result: { archived: nextStatus === "archived", status: nextStatus, changed },
      });
      if (changed) {
        await transaction.insert(auditEvents).values({
          commonsId: lockedCommons.id,
          commandId: command.commandId,
          actorId: actorRow.personId,
          actorType: "human",
          action: command.archived ? "commons.archived" : "commons.restored",
          resourceType: "commons",
          resourceId: lockedCommons.id,
          summary: command.archived
            ? `${actorRow.displayName} archived ${lockedCommons.name}.`
            : `${actorRow.displayName} restored ${lockedCommons.name}.`,
        });
      }
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function getCommonsSnapshot(
  slug: string,
  options: PilotRepositoryOptions,
) {
  const database = createDatabase(options.databaseUrl);
  try {
    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function getCommonsMomentAsset(
  slug: string,
  momentId: string,
  options: PilotRepositoryOptions,
) {
  const database = createDatabase(options.databaseUrl);
  try {
    const [asset] = await database.db
      .select({
        id: moments.id,
        storagePath: moments.storagePath,
        mimeType: moments.mimeType,
      })
      .from(moments)
      .innerJoin(commons, eq(moments.commonsId, commons.id))
      .innerJoin(
        memberships,
        and(
          eq(memberships.commonsId, commons.id),
          eq(memberships.personId, options.actorPersonId),
        ),
      )
      .where(
        and(
          eq(commons.slug, slug),
          eq(moments.id, momentId),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    return asset ?? null;
  } finally {
    await database.close();
  }
}

export async function findCommonsConfirmationImport(slug: string, storagePath: string, options: PilotRepositoryOptions) {
  assertConfirmationDocumentPath(slug, options.actorPersonId, storagePath);
  const database = createDatabase(options.databaseUrl);
  try {
    const [document] = await database.db.select({ travelPlanId: confirmationDocuments.travelPlanId, stayId: confirmationDocuments.stayId })
      .from(confirmationDocuments)
      .innerJoin(commons, eq(commons.id, confirmationDocuments.commonsId))
      .innerJoin(memberships, and(eq(memberships.commonsId, commons.id), eq(memberships.personId, options.actorPersonId)))
      .where(and(eq(commons.slug, slug), eq(memberships.status, "active"), eq(confirmationDocuments.ownerPersonId, options.actorPersonId), eq(confirmationDocuments.storagePath, storagePath))).limit(1);
    return document ?? null;
  } finally { await database.close(); }
}

export async function getCommonsConfirmationAsset(
  slug: string,
  resourceType: "stay" | "travel" | "expense",
  resourceId: string,
  options: PilotRepositoryOptions,
) {
  const database = createDatabase(options.databaseUrl);
  try {
    const [membership] = await database.db.select({ commonsId: commons.id })
      .from(commons)
      .innerJoin(memberships, and(eq(memberships.commonsId, commons.id), eq(memberships.personId, options.actorPersonId)))
      .where(and(eq(commons.slug, slug), eq(memberships.status, "active")))
      .limit(1);
    if (!membership) return null;
    const [asset] = await database.db.select({
      storagePath: confirmationDocuments.storagePath,
      mimeType: confirmationDocuments.mimeType,
      fileName: confirmationDocuments.fileName,
    }).from(confirmationDocuments).where(and(
      eq(confirmationDocuments.commonsId, membership.commonsId),
      eq(confirmationDocuments.ownerPersonId, options.actorPersonId),
      resourceType === "stay"
        ? eq(confirmationDocuments.stayId, resourceId)
        : resourceType === "travel"
          ? eq(confirmationDocuments.travelPlanId, resourceId)
          : eq(confirmationDocuments.expenseId, resourceId),
    )).limit(1);
    return asset ?? null;
  } finally {
    await database.close();
  }
}

export async function updateCommonsCover(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = UpdateCommonsCoverRequestSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      await transaction
        .select({ id: commons.id })
        .from(commons)
        .where(eq(commons.id, commonsRecord.id))
        .for("update");

      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(
          and(
            eq(processedCommands.commonsId, commonsRecord.id),
            eq(processedCommands.commandId, command.commandId),
          ),
        )
        .limit(1);
      if (alreadyProcessed) return;

      const [actorRow] = await transaction
        .select({
          personId: people.id,
          displayName: people.displayName,
          status: memberships.status,
        })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(
          and(
            eq(memberships.commonsId, commonsRecord.id),
            eq(memberships.personId, options.actorPersonId),
          ),
        )
        .limit(1);
      if (!actorRow || actorRow.status !== "active") {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "Only an active participant can change the trip cover.",
        );
      }

      const escapedSlug = escapeRegularExpression(slug);
      const uuidPattern = "([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})";
      const coverPathMatch = command.originalStoragePath.match(new RegExp(`^${escapedSlug}/covers/${uuidPattern}/original\\.(jpg|png|webp)$`, "i"));
      const cardPathMatch = command.cardStoragePath.match(new RegExp(`^${escapedSlug}/covers/${uuidPattern}/card\\.webp$`, "i"));
      const expectedExtension = command.mimeType === "image/jpeg" ? "jpg" : command.mimeType.split("/")[1];
      if (!coverPathMatch || !cardPathMatch || coverPathMatch[1] !== cardPathMatch[1] || coverPathMatch[2] !== expectedExtension) {
        throw new CommonsRepositoryError("actor_not_authorized", "That cover upload does not belong to this trip.");
      }
      if (command.sourceMomentId) {
        const [momentRow] = await transaction
          .select({ id: moments.id })
          .from(moments)
          .where(and(eq(moments.commonsId, commonsRecord.id), eq(moments.id, command.sourceMomentId)))
          .limit(1);
        if (!momentRow) throw new CommonsRepositoryError("moment_not_found", "Choose a photo from this Commons.");
      }

      const version = encodeURIComponent(command.commandId);
      const coverImageUrl = `/api/v1/commons/${slug}/cover-image?variant=original&v=${version}`;
      const coverCardImageUrl = `/api/v1/commons/${slug}/cover-image?variant=card&v=${version}`;
      await transaction
        .update(commons)
        .set({
          coverImageUrl,
          coverCardImageUrl,
          coverOriginalStoragePath: command.originalStoragePath,
          coverCardStoragePath: command.cardStoragePath,
          coverMimeType: command.mimeType,
          coverSourceMomentId: command.sourceMomentId,
          updatedAt: new Date(),
        })
        .where(eq(commons.id, commonsRecord.id));
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { coverImageUrl, coverCardImageUrl, sourceMomentId: command.sourceMomentId },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "commons.cover_updated",
        resourceType: "commons",
        resourceId: commonsRecord.id,
        summary: `${actorRow.displayName} changed the trip cover.`,
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function getCommonsCoverAsset(
  slug: string,
  variant: "original" | "card",
  options: PilotRepositoryOptions,
) {
  const database = createDatabase(options.databaseUrl);
  try {
    const [asset] = await database.db
      .select({
        commonsId: commons.id,
        coverImageUrl: commons.coverImageUrl,
        originalStoragePath: commons.coverOriginalStoragePath,
        cardStoragePath: commons.coverCardStoragePath,
        mimeType: commons.coverMimeType,
      })
      .from(commons)
      .innerJoin(memberships, and(eq(memberships.commonsId, commons.id), eq(memberships.personId, options.actorPersonId)))
      .where(and(eq(commons.slug, slug), eq(memberships.status, "active")))
      .limit(1);
    if (!asset) return null;
    if (variant === "card" && asset.cardStoragePath) {
      return { storagePath: asset.cardStoragePath, mimeType: "image/webp" };
    }
    if (asset.originalStoragePath && asset.mimeType) {
      if (variant === "original") {
        return { storagePath: asset.originalStoragePath, mimeType: asset.mimeType };
      }
      const legacyCardStoragePath = asset.originalStoragePath.replace(/\/original\.[^/]+$/i, "/card.webp");
      if (legacyCardStoragePath !== asset.originalStoragePath) {
        return {
          storagePath: legacyCardStoragePath,
          mimeType: "image/webp",
          fallbackStoragePath: asset.originalStoragePath,
        };
      }
    }
    const momentPrefix = `/api/v1/commons/${slug}/moments/`;
    if (!asset.coverImageUrl?.startsWith(momentPrefix)) return null;
    if (variant === "original") return null;
    const momentId = asset.coverImageUrl.slice(momentPrefix.length).split(/[/?#]/, 1)[0];
    if (!momentId) return null;
    const [legacyMoment] = await database.db
      .select({ storagePath: moments.storagePath, mimeType: moments.mimeType })
      .from(moments)
      .where(and(eq(moments.commonsId, asset.commonsId), eq(moments.id, momentId)))
      .limit(1);
    if (!legacyMoment) return null;
    return {
      storagePath: `${slug}/cover-cards/${momentId}.webp`,
      mimeType: "image/webp",
      fallbackStoragePath: legacyMoment.storagePath,
    };
  } finally {
    await database.close();
  }
}

/** Presentation only: it cannot touch dates, bookings, balances or permissions. */
export async function updateTripLetter(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = UpdateTripLetterRequestSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [found] = await database.db.select({ id: commons.id }).from(commons).where(eq(commons.slug, slug)).limit(1);
    if (!found) throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    await database.db.transaction(async (transaction) => {
      const [trip] = await transaction.select().from(commons).where(eq(commons.id, found.id)).for("update");
      const [alreadyProcessed] = await transaction.select({ commandId: processedCommands.commandId }).from(processedCommands)
        .where(and(eq(processedCommands.commonsId, trip.id), eq(processedCommands.commandId, command.commandId))).limit(1);
      if (alreadyProcessed) return;
      const [actor] = await transaction.select({ personId: people.id, displayName: people.displayName, role: memberships.role, status: memberships.status })
        .from(memberships).innerJoin(people, eq(memberships.personId, people.id))
        .where(and(eq(memberships.commonsId, trip.id), eq(memberships.personId, options.actorPersonId))).limit(1);
      if (!actor || actor.status !== "active" || actor.role !== "organizer") throw new CommonsRepositoryError("actor_not_authorized", "Only an organizer can change this page.");
      const changes: Partial<typeof commons.$inferInsert> = { updatedAt: new Date() };
      if (command.welcome) {
        if ((trip.welcomeMessage ?? null) !== (command.welcome.expected ?? null)) throw new CommonsRepositoryError("letter_conflict", "Someone else changed the welcome. Review the latest version.");
        changes.welcomeMessage = command.welcome.text || null;
        changes.welcomeAuthorPersonId = command.welcome.text ? actor.personId : null;
      }
      if (command.sections) {
        if (JSON.stringify(trip.letterSections ?? null) !== JSON.stringify(command.sections.expected ?? null)) throw new CommonsRepositoryError("letter_conflict", "Someone else rearranged this page. Review the latest version.");
        changes.letterSections = command.sections.value;
      }
      await transaction.update(commons).set(changes).where(eq(commons.id, trip.id));
      await transaction.insert(processedCommands).values({ commonsId: trip.id, commandId: command.commandId, result: { updated: Object.keys(changes) } });
      await transaction.insert(auditEvents).values({
        commonsId: trip.id, commandId: command.commandId, actorId: actor.personId, actorType: "human",
        action: "commons.letter_updated", resourceType: "commons", resourceId: trip.id,
        summary: `${actor.displayName} updated the trip page.`,
      });
    });
    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function updateCommonsTitle(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = UpdateCommonsTitleRequestSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      await transaction
        .select({ id: commons.id })
        .from(commons)
        .where(eq(commons.id, commonsRecord.id))
        .for("update");

      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        ))
        .limit(1);
      if (alreadyProcessed) return;

      const [actorRow] = await transaction
        .select({
          personId: people.id,
          displayName: people.displayName,
          role: memberships.role,
          status: memberships.status,
        })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(and(
          eq(memberships.commonsId, commonsRecord.id),
          eq(memberships.personId, options.actorPersonId),
        ))
        .limit(1);
      if (!actorRow || actorRow.status !== "active" || actorRow.role !== "organizer") {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "Only an organizer can change the trip title.",
        );
      }

      await transaction
        .update(commons)
        .set({ name: command.title, updatedAt: new Date() })
        .where(eq(commons.id, commonsRecord.id));
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { title: command.title },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "commons.title_updated",
        resourceType: "commons",
        resourceId: commonsRecord.id,
        summary: `${actorRow.displayName} changed the trip title.`,
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function updateCommonsDetails(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = UpdateCommonsDetailsRequestSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      const [currentTrip] = await transaction.select({ id: commons.id, currency: commons.currency }).from(commons)
        .where(eq(commons.id, commonsRecord.id)).for("update");
      const [alreadyProcessed] = await transaction.select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        )).limit(1);
      if (alreadyProcessed) return;

      const [actorRow] = await transaction.select({
        personId: people.id,
        displayName: people.displayName,
        role: memberships.role,
        status: memberships.status,
      }).from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(and(
          eq(memberships.commonsId, commonsRecord.id),
          eq(memberships.personId, options.actorPersonId),
        )).limit(1);
      if (!actorRow || actorRow.status !== "active" || actorRow.role !== "organizer") {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "Only an organizer can change trip details.",
        );
      }

      if (command.currency !== undefined && currentTrip.currency !== command.expectedCurrency) {
        throw new CommandConflictError();
      }

      await transaction.update(commons).set({
        currency: command.currency,
        name: command.title,
        timezone: command.timezone,
        startsOn: command.startsOn,
        endsOn: command.endsOn,
        locationName: command.locationNames[0] ?? command.locationName ?? null,
        locationNames: command.locationNames.length
          ? command.locationNames
          : command.locationName ? [command.locationName] : [],
        balancesDisabled: command.balancesDisabled,
        updatedAt: new Date(),
      }).where(eq(commons.id, commonsRecord.id));
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { commonsId: commonsRecord.id },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "commons.details_updated",
        resourceType: "commons",
        resourceId: commonsRecord.id,
        summary: `${actorRow.displayName} updated the trip details.`,
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function updateCommonsMoment(
  slug: string,
  momentId: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = UpdateMomentRequestSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id, timezone: commons.timezone })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      await transaction
        .select({ id: commons.id })
        .from(commons)
        .where(eq(commons.id, commonsRecord.id))
        .for("update");

      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(
          and(
            eq(processedCommands.commonsId, commonsRecord.id),
            eq(processedCommands.commandId, command.commandId),
          ),
        )
        .limit(1);
      if (alreadyProcessed) return;

      const [actorRow] = await transaction
        .select({
          personId: people.id,
          displayName: people.displayName,
          status: memberships.status,
        })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(
          and(
            eq(memberships.commonsId, commonsRecord.id),
            eq(memberships.personId, options.actorPersonId),
          ),
        )
        .limit(1);
      if (!actorRow || actorRow.status !== "active") {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "Only an active participant can edit a photo.",
        );
      }

      const [momentRecord] = await transaction
        .select({ id: moments.id })
        .from(moments)
        .where(
          and(
            eq(moments.commonsId, commonsRecord.id),
            eq(moments.id, momentId),
          ),
        )
        .for("update")
        .limit(1);
      if (!momentRecord) {
        throw new CommonsRepositoryError("moment_not_found", "Photo not found.");
      }

      let linkedStartsAt: Date | null = null;
      if (command.itineraryItemId) {
        const [itineraryRecord] = await transaction
          .select({ id: itineraryItems.id, startsAt: itineraryItems.startsAt })
          .from(itineraryItems)
          .where(
            and(
              eq(itineraryItems.commonsId, commonsRecord.id),
              eq(itineraryItems.id, command.itineraryItemId),
            ),
          )
          .limit(1);
        if (!itineraryRecord) {
          throw new CommonsRepositoryError(
            "actor_not_authorized",
            "Choose a plan from this Commons.",
          );
        }
        linkedStartsAt = itineraryRecord.startsAt;
      }

      const assignedDay = command.occurredOn
        ? localDateTimeToDate(command.occurredOn, "12:00", commonsRecord.timezone)
        : null;

      await transaction
        .update(moments)
        .set({
          caption: command.caption,
          occurredAt: linkedStartsAt ?? assignedDay ?? undefined,
          dateStatus: command.itineraryItemId || command.occurredOn ? "confirmed" : "unconfirmed",
          itineraryItemId: command.itineraryItemId,
          eventMatchSource: command.itineraryItemId ? "manual" : null,
          eventMatchConfidence: command.itineraryItemId ? 100 : null,
          eventMatchReason: command.itineraryItemId
            ? `Linked by ${actorRow.displayName}`
            : null,
          updatedAt: new Date(),
        })
        .where(eq(moments.id, momentRecord.id));
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { momentId: momentRecord.id },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "moment.updated",
        resourceType: "moment",
        resourceId: momentRecord.id,
        summary: `${actorRow.displayName} updated ${command.caption}.`,
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function deleteCommonsMoment(
  slug: string,
  momentId: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = DeleteMomentRequestSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(tx => runEventCommand(tx, {
      identifier: slug, actorPersonId: options.actorPersonId, commandId: command.commandId,
      action: "moment.deleted", input: { ...command, momentId },
    }, () => {}, async context => {
      const [moment] = await tx.select().from(moments)
        .where(and(eq(moments.commonsId, context.id), eq(moments.id, momentId))).for("update").limit(1);
      if (!moment) throw new CommonsRepositoryError("moment_not_found", "Photo not found.");
      await tx.insert(photoDeletions).values({ storagePath: moment.storagePath }).onConflictDoNothing();
      await tx.delete(moments).where(eq(moments.id, moment.id));
      await tx.update(commons).set({ coverImageUrl: null, updatedAt: context.now })
        .where(and(eq(commons.id, context.id), eq(commons.coverImageUrl, `/api/v1/commons/${slug}/moments/${moment.id}`)));
      return { result: { momentId, deleted: true }, resourceType: "moment", resourceId: momentId,
        summary: `${context.displayName} deleted ${moment.caption}.` };
    }));

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function upsertCommonsFlightBooking(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = UpsertFlightBookingCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db.select({ id: commons.id }).from(commons).where(eq(commons.slug, slug)).limit(1);
    if (!commonsRecord) throw new CommonsRepositoryError("commons_not_found", "Trip not found.");

    await database.db.transaction(async (transaction) => {
      await transaction.select({ id: commons.id }).from(commons).where(eq(commons.id, commonsRecord.id)).for("update");
      const [processed] = await transaction.select({ id: processedCommands.id }).from(processedCommands).where(and(
        eq(processedCommands.commonsId, commonsRecord.id),
        eq(processedCommands.commandId, command.commandId),
      )).limit(1);
      if (processed) return;

      const memberRows = await transaction.select({
        personId: people.id,
        displayName: people.displayName,
        status: memberships.status,
      }).from(memberships).innerJoin(people, eq(memberships.personId, people.id)).where(eq(memberships.commonsId, commonsRecord.id));
      const actor = memberRows.find((member) => member.personId === options.actorPersonId);
      if (!actor || actor.status !== "active") throw new CommonsRepositoryError("actor_not_authorized", "Only an active participant can save a flight booking.");
      const includedPersonIds = [...new Set(command.includedPersonIds)];
      if (includedPersonIds.some((personId) => !memberRows.some((member) => member.personId === personId && ["active", "invited"].includes(member.status)))) {
        throw new CommonsRepositoryError("actor_not_authorized", "A flight booking can include only active or invited people in this trip.");
      }
      if (command.confirmationDocument) {
        assertConfirmationDocumentPath(slug, actor.personId, command.confirmationDocument.storagePath);
        await consumeConfirmationIntake(transaction, commonsRecord.id, actor.personId, command.confirmationDocument);
      }

      const existingPlans = await transaction.select({
        id: travelPlans.id,
        version: travelPlans.updatedAt,
        personId: travelPlans.personId,
        companionPersonId: travelPlans.companionPersonId,
        kind: travelPlans.kind,
      }).from(travelPlans).where(and(
        eq(travelPlans.commonsId, commonsRecord.id),
        inArray(travelPlans.kind, ["arrival", "departure"]),
      ));
      const existingParticipants = existingPlans.length ? await transaction.select({
        travelPlanId: travelPlanParticipants.travelPlanId,
        personId: travelPlanParticipants.personId,
      }).from(travelPlanParticipants).where(inArray(travelPlanParticipants.travelPlanId, existingPlans.map((plan) => plan.id))) : [];
      if (command.expectedPlanVersions) {
        const owned = existingPlans.filter(plan => plan.personId === actor.personId);
        if (owned.length !== command.expectedPlanVersions.length || owned.some(plan => !command.expectedPlanVersions!.some(expected => expected.id === plan.id && expected.version === iso(plan.version)))) {
          throw new CommonsRepositoryError("travel_plan_conflict", "Your flight booking changed. Reopen it before saving; your saved plans are unchanged.");
        }
      }
      for (const leg of command.legs) {
        const conflict = existingPlans.find((plan) => plan.kind === leg.kind && plan.personId !== actor.personId && includedPersonIds.some((personId) =>
          plan.personId === personId || plan.companionPersonId === personId || existingParticipants.some((participant) => participant.travelPlanId === plan.id && participant.personId === personId),
        ));
        if (conflict) throw new CommonsRepositoryError("travel_plan_conflict", "One of these travelers already has a plan. Update that plan instead.");
      }

      const sourceLabel = command.confirmationDocument
        ? `From a private confirmation · confirmed by ${actor.displayName.split(" ")[0]}`
        : `Saved by ${actor.displayName.split(" ")[0]}`;
      const savedIds: string[] = [];
      for (const leg of command.legs) {
        const [saved] = await transaction.insert(travelPlans).values({
          commonsId: commonsRecord.id,
          personId: actor.personId,
          companionPersonId: includedPersonIds.find((personId) => personId !== actor.personId) ?? null,
          kind: leg.kind,
          visibility: "basic",
          date: leg.date,
          route: leg.route,
          connections: leg.connections ?? [],
          time: leg.time,
          note: command.note || null,
          confirmationCode: command.confirmationCode,
          totalCents: null,
          currency: command.currency,
          sourceLabel,
        }).onConflictDoUpdate({
          target: [travelPlans.commonsId, travelPlans.personId, travelPlans.kind],
          targetWhere: sql`${travelPlans.kind} in ('arrival', 'departure')`,
          set: {
            companionPersonId: includedPersonIds.find((personId) => personId !== actor.personId) ?? null,
            date: leg.date,
            route: leg.route,
            connections: leg.connections ?? undefined,
            time: leg.time,
            note: command.note || null,
            confirmationCode: command.confirmationCode,
            visibility: "basic",
            sourceLabel,
            updatedAt: new Date(),
          },
        }).returning({ id: travelPlans.id });
        if (!saved) throw new Error("Flight booking was not saved.");
        savedIds.push(saved.id);
        await transaction.delete(travelPlanParticipants).where(eq(travelPlanParticipants.travelPlanId, saved.id));
        await transaction.insert(travelPlanParticipants).values(includedPersonIds.map((personId) => ({ travelPlanId: saved.id, personId })));
      }
      if (command.removeLegKinds.length) {
        await transaction.delete(travelPlans).where(and(
          eq(travelPlans.commonsId, commonsRecord.id),
          eq(travelPlans.personId, actor.personId),
          inArray(travelPlans.kind, command.removeLegKinds),
        ));
      }
      if (command.confirmationDocument) {
        await transaction.insert(confirmationDocuments).values({
          commonsId: commonsRecord.id,
          ownerPersonId: actor.personId,
          storagePath: command.confirmationDocument.storagePath,
          fileName: command.confirmationDocument.fileName,
          mimeType: command.confirmationDocument.mimeType,
          travelPlanId: savedIds[0],
        }).onConflictDoUpdate({
          target: confirmationDocuments.travelPlanId,
          set: { ownerPersonId: actor.personId, storagePath: command.confirmationDocument.storagePath, fileName: command.confirmationDocument.fileName, mimeType: command.confirmationDocument.mimeType, updatedAt: new Date() },
        });
      }
      await transaction.insert(processedCommands).values({ commonsId: commonsRecord.id, commandId: command.commandId, result: { travelPlanIds: savedIds } });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actor.personId,
        actorType: "human",
        action: "travel_booking.saved",
        resourceType: "travel_plan",
        resourceId: savedIds[0],
        summary: `${actor.displayName} saved ${savedIds.length === 2 ? "a round-trip flight booking" : "a flight booking"}.`,
      });
    });
    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function upsertCommonsTravelPlan(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = UpsertTravelPlanCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(transaction => upsertCommonsTravelPlanInTransaction(transaction, commonsRecord, slug, command, options));

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function upsertCommonsTravelPlanInTransaction(transaction: CommandTransaction, commonsRecord: { id: string }, slug: string, input: unknown, options: PilotRepositoryOptions) {
  const command = UpsertTravelPlanCommandSchema.parse(input);
      await transaction
        .select({ id: commons.id })
        .from(commons)
        .where(eq(commons.id, commonsRecord.id))
        .for("update");

      const [processed] = await transaction
        .select({ id: processedCommands.id })
        .from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        ))
        .limit(1);
      if (processed) return;

      const memberRows = await transaction
        .select({
          personId: people.id,
          displayName: people.displayName,
          status: memberships.status,
        })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(eq(memberships.commonsId, commonsRecord.id));
      const actor = memberRows.find((member) => member.personId === options.actorPersonId);
      if (!actor || actor.status !== "active") {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "Only an active participant can save a travel plan.",
        );
      }
      if (command.confirmationDocument) {
        assertConfirmationDocumentPath(slug, actor.personId, command.confirmationDocument.storagePath);
        await consumeConfirmationIntake(transaction, commonsRecord.id, actor.personId, command.confirmationDocument);
      }
      if (command.companionPersonId === actor.personId) {
        throw new CommonsRepositoryError(
          "travel_plan_conflict",
          "Choose a different traveler.",
        );
      }
      const companion = command.companionPersonId
        ? memberRows.find((member) => member.personId === command.companionPersonId)
        : null;
      if (command.companionPersonId && (!companion || !["active", "invited"].includes(companion.status))) {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "A travel plan can include only active or invited people in this trip.",
        );
      }

      const requestedPersonIds = [...new Set(command.includedPersonIds.length
        ? command.includedPersonIds
        : [actor.personId, ...(companion ? [companion.personId] : [])])];
      if (!requestedPersonIds.length) {
        throw new CommonsRepositoryError("travel_plan_conflict", "Choose at least one traveler for this plan.");
      }
      if (requestedPersonIds.some((personId) => !memberRows.some((member) => member.personId === personId && ["active", "invited"].includes(member.status)))) {
        throw new CommonsRepositoryError("actor_not_authorized", "A travel plan can include only active or invited people in this trip.");
      }
      if (["car_rental", "transport"].includes(command.kind) && command.driverPersonId && !requestedPersonIds.includes(command.driverPersonId)) {
        throw new CommonsRepositoryError("travel_plan_conflict", "The driver must be included in this rental.");
      }
      if (["car_rental", "transport"].includes(command.kind) && command.returnDate && command.returnDate < command.date) {
        throw new CommonsRepositoryError("travel_plan_conflict", "The return date must be on or after pick-up.");
      }

      const existingKindPlans = await transaction
        .select({
          id: travelPlans.id,
          personId: travelPlans.personId,
          companionPersonId: travelPlans.companionPersonId,
        })
        .from(travelPlans)
        .where(and(
          eq(travelPlans.commonsId, commonsRecord.id),
          eq(travelPlans.kind, command.kind),
        ));
      const existingParticipantRows = existingKindPlans.length ? await transaction
        .select({ travelPlanId: travelPlanParticipants.travelPlanId, personId: travelPlanParticipants.personId })
        .from(travelPlanParticipants)
        .where(inArray(travelPlanParticipants.travelPlanId, existingKindPlans.map((plan) => plan.id))) : [];
      const participantsInThisPlan = requestedPersonIds;
      const conflictingPlan = existingKindPlans.find((plan) =>
        ["arrival", "departure"].includes(command.kind) && plan.personId !== actor.personId && participantsInThisPlan.some((personId) =>
          existingParticipantRows.some((participant) => participant.travelPlanId === plan.id && participant.personId === personId)
          || plan.personId === personId || plan.companionPersonId === personId),
      );
      if (conflictingPlan) {
        throw new CommonsRepositoryError(
          "travel_plan_conflict",
          "One of these travelers already has a plan. Update that plan instead.",
        );
      }

      const sourceLabel = command.confirmationDocument
        ? `From a private confirmation · confirmed by ${actor.displayName.split(" ")[0]}`
        : `Saved by ${actor.displayName.split(" ")[0]}`;
      const values = {
          commonsId: commonsRecord.id,
          personId: actor.personId,
          companionPersonId: ["car_rental", "transport"].includes(command.kind) ? null : requestedPersonIds.find((personId) => personId !== actor.personId) ?? null,
          kind: command.kind,
          date: command.date,
          route: command.route,
          time: command.time,
          driverPersonId: command.kind === "car_rental" ? command.driverPersonId ?? actor.personId : command.driverPersonId,
          provider: ["car_rental", "transport"].includes(command.kind) ? command.provider || null : null,
          vehicle: ["car_rental", "transport"].includes(command.kind) ? command.vehicle || null : null,
          returnDate: ["car_rental", "transport"].includes(command.kind) ? command.returnDate : null,
          returnTime: ["car_rental", "transport"].includes(command.kind) ? command.returnTime : null,
          status: ["car_rental", "transport"].includes(command.kind) ? command.status : "confirmed",
          note: command.note || null,
          confirmationCode: command.confirmationCode,
          totalCents: ["arrival", "departure"].includes(command.kind) ? null : command.totalCents,
          currency: command.currency,
          sourceLabel,
      };
      let saved: { id: string } | undefined;
      if (["car_rental", "transport"].includes(command.kind) && command.travelPlanId) {
        [saved] = await transaction.update(travelPlans).set({ ...values, updatedAt: new Date() }).where(and(
          eq(travelPlans.id, command.travelPlanId),
          eq(travelPlans.commonsId, commonsRecord.id),
          eq(travelPlans.personId, actor.personId),
          eq(travelPlans.kind, command.kind),
        )).returning({ id: travelPlans.id });
        if (!saved) throw new CommonsRepositoryError("actor_not_authorized", "Only the person who added this rental can edit it.");
      } else if (["car_rental", "transport"].includes(command.kind)) {
        [saved] = await transaction.insert(travelPlans).values({ ...values, visibility: command.kind === "transport" ? "basic" : "private" }).returning({ id: travelPlans.id });
      } else {
        [saved] = await transaction.insert(travelPlans).values({ ...values, visibility: "basic" }).onConflictDoUpdate({
          target: [travelPlans.commonsId, travelPlans.personId, travelPlans.kind],
          targetWhere: sql`${travelPlans.kind} in ('arrival', 'departure')`,
          set: { ...values, totalCents: sql`${travelPlans.totalCents}`, currency: sql`${travelPlans.currency}`, visibility: "basic", updatedAt: new Date() },
        }).returning({ id: travelPlans.id });
      }
      if (!saved) throw new Error("Travel plan was not saved.");
      await transaction.delete(travelPlanParticipants).where(eq(travelPlanParticipants.travelPlanId, saved.id));
      await transaction.insert(travelPlanParticipants).values(requestedPersonIds.map((personId) => ({
        travelPlanId: saved!.id,
        personId,
      })));
      if (command.confirmationDocument) {
        await transaction.insert(confirmationDocuments).values({
          commonsId: commonsRecord.id,
          ownerPersonId: actor.personId,
          storagePath: command.confirmationDocument.storagePath,
          fileName: command.confirmationDocument.fileName,
          mimeType: command.confirmationDocument.mimeType,
          travelPlanId: saved.id,
        }).onConflictDoUpdate({
          target: confirmationDocuments.travelPlanId,
          set: {
            ownerPersonId: actor.personId,
            storagePath: command.confirmationDocument.storagePath,
            fileName: command.confirmationDocument.fileName,
            mimeType: command.confirmationDocument.mimeType,
            updatedAt: new Date(),
          },
        });
      }

      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { travelPlanId: saved.id },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actor.personId,
        actorType: "human",
        action: "travel_plan.saved",
        resourceType: "travel_plan",
        resourceId: saved.id,
        summary: `${actor.displayName} saved a ${command.kind} plan for ${command.date}.`,
      });
}

export async function updateCommonsTravelPlanSharing(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = UpdateTravelPlanSharingCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) throw new CommonsRepositoryError("commons_not_found", "Trip not found.");

    await database.db.transaction(async (transaction) => {
      await transaction.select({ id: commons.id }).from(commons).where(eq(commons.id, commonsRecord.id)).for("update");
      const [actor] = await transaction
        .select({ id: people.id, displayName: people.displayName, status: memberships.status })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(and(eq(memberships.commonsId, commonsRecord.id), eq(people.id, options.actorPersonId)))
        .limit(1);
      if (!actor || actor.status !== "active") {
        throw new CommonsRepositoryError("actor_not_authorized", "Only an active participant can share a travel plan.");
      }
      const [plan] = await transaction
        .select({ id: travelPlans.id, personId: travelPlans.personId, version: travelPlans.updatedAt, kind: travelPlans.kind })
        .from(travelPlans)
        .where(and(eq(travelPlans.id, command.travelPlanId), eq(travelPlans.commonsId, commonsRecord.id)))
        .limit(1);
      if (!plan) throw new CommonsRepositoryError("travel_plan_not_found", "Travel plan not found.");
      if (plan.personId !== actor.id) {
        throw new CommonsRepositoryError("actor_not_authorized", "Only the person who added this travel plan can change what is shared.");
      }
      if (["arrival", "departure"].includes(plan.kind) && command.visibility !== "basic") throw new CommonsRepositoryError("actor_not_authorized", "Flights share their basic details with the trip. Add costs separately in Money.");
      const [processed] = await transaction
        .select({ id: processedCommands.id })
        .from(processedCommands)
        .where(and(eq(processedCommands.commonsId, commonsRecord.id), eq(processedCommands.commandId, command.commandId)))
        .limit(1);
      if (processed) return;

      if (command.expectedVersion && command.expectedVersion !== iso(plan.version)) {
        throw new CommonsRepositoryError("travel_plan_conflict", "This travel plan changed. Reopen it before changing what is shared.");
      }
      await transaction.update(travelPlans).set({
        visibility: command.visibility,
        sourceLabel: command.visibility === "private"
          ? `Saved by ${actor.displayName.split(" ")[0]}`
          : `Shared by ${actor.displayName.split(" ")[0]}`,
        updatedAt: new Date(),
      }).where(eq(travelPlans.id, plan.id));
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { travelPlanId: plan.id, visibility: command.visibility },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actor.id,
        actorType: "human",
        action: "travel_plan.sharing_updated",
        resourceType: "travel_plan",
        resourceId: plan.id,
        summary: command.visibility === "private"
          ? `${actor.displayName} made a travel plan private.`
          : `${actor.displayName} shared ${command.visibility} travel details.`,
      });
    });
    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function deleteCommonsTravelPlan(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = DeleteTravelPlanCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db.select({ id: commons.id }).from(commons)
      .where(eq(commons.slug, slug)).limit(1);
    if (!commonsRecord) throw new CommonsRepositoryError("commons_not_found", "Trip not found.");

    await database.db.transaction(async (transaction) => {
      await transaction.select({ id: commons.id }).from(commons)
        .where(eq(commons.id, commonsRecord.id)).for("update");
      const [processed] = await transaction.select({ id: processedCommands.id }).from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        )).limit(1);
      if (processed) return;

      const [plan] = await transaction.select({
        id: travelPlans.id,
        personId: travelPlans.personId,
        kind: travelPlans.kind,
      }).from(travelPlans).where(and(
        eq(travelPlans.id, command.travelPlanId),
        eq(travelPlans.commonsId, commonsRecord.id),
      )).limit(1);
      if (!plan) throw new CommonsRepositoryError("travel_plan_not_found", "That travel plan is no longer available.");
      if (plan.personId !== options.actorPersonId) {
        throw new CommonsRepositoryError("actor_not_authorized", "Only the person who added this travel plan can remove it.");
      }
      const [actor] = await transaction.select({
        id: people.id,
        displayName: people.displayName,
        status: memberships.status,
      }).from(memberships).innerJoin(people, eq(memberships.personId, people.id)).where(and(
        eq(memberships.commonsId, commonsRecord.id),
        eq(people.id, options.actorPersonId),
      )).limit(1);
      if (!actor || actor.status !== "active") {
        throw new CommonsRepositoryError("actor_not_authorized", "Only an active participant can remove a travel plan.");
      }

      await transaction.update(confirmationDocuments)
        .set({ travelPlanId: null, updatedAt: new Date() })
        .where(and(eq(confirmationDocuments.travelPlanId, plan.id), isNotNull(confirmationDocuments.expenseId)));
      await transaction.delete(travelPlans).where(eq(travelPlans.id, plan.id));
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { travelPlanId: plan.id },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actor.id,
        actorType: "human",
        action: "travel_plan.deleted",
        resourceType: "travel_plan",
        resourceId: plan.id,
        summary: `${actor.displayName} removed a ${plan.kind.replace("_", " ")} plan.`,
      });
    });
    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

type PlacePinRow = { pinLatitude: number | null; pinLongitude: number | null; pinPrecision: "exact" | "approximate" | null; pinSource: "map_link" | "page" | "placed" | null };
function savedPlacePin(row: PlacePinRow): PlacePin | undefined {
  return row.pinLatitude === null || row.pinLongitude === null || !row.pinPrecision || !row.pinSource ? undefined
    : { latitude: row.pinLatitude, longitude: row.pinLongitude, precision: row.pinPrecision, source: row.pinSource };
}
/** Omitted keeps the saved pin; null removes it. */
function placePinColumns(pin: PlacePin | null | undefined): Partial<PlacePinRow> {
  if (pin === undefined) return {};
  return pin === null ? { pinLatitude: null, pinLongitude: null, pinPrecision: null, pinSource: null }
    : { pinLatitude: pin.latitude, pinLongitude: pin.longitude, pinPrecision: pin.precision, pinSource: pin.source };
}

/** Saves or removes only a place's map pin. Stays keep their organizer-only
 * editing rule and activities their active-participant rule. */
export async function setCommonsPlacePin(slug: string, input: unknown, options: PilotRepositoryOptions) {
  const command = SetPlacePinCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db.select({ id: commons.id }).from(commons)
      .where(eq(commons.slug, slug)).limit(1);
    if (!commonsRecord) throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    await database.db.transaction(async (transaction) => {
      await transaction.select({ id: commons.id }).from(commons)
        .where(eq(commons.id, commonsRecord.id)).for("update");
      const [processed] = await transaction.select({ id: processedCommands.id }).from(processedCommands)
        .where(and(eq(processedCommands.commonsId, commonsRecord.id), eq(processedCommands.commandId, command.commandId))).limit(1);
      if (processed) return;
      const [actor] = await transaction.select({ personId: people.id, displayName: people.displayName, role: memberships.role, status: memberships.status })
        .from(memberships).innerJoin(people, eq(memberships.personId, people.id))
        .where(and(eq(memberships.commonsId, commonsRecord.id), eq(memberships.personId, options.actorPersonId))).limit(1);
      if (!actor || actor.status !== "active" || (command.kind === "stay" && actor.role !== "organizer")) {
        throw new CommonsRepositoryError("actor_not_authorized", command.kind === "stay" ? "Only an organizer can manage stays." : "Only an active participant can edit a plan.");
      }
      const table = command.kind === "stay" ? stayRecords : itineraryItems;
      const [place] = command.kind === "stay"
        ? await transaction.select({ id: stayRecords.id, name: stayRecords.name }).from(stayRecords)
          .where(and(eq(stayRecords.commonsId, commonsRecord.id), eq(stayRecords.id, command.id))).for("update").limit(1)
        : await transaction.select({ id: itineraryItems.id, name: itineraryItems.title }).from(itineraryItems)
          .where(and(eq(itineraryItems.commonsId, commonsRecord.id), eq(itineraryItems.id, command.id))).for("update").limit(1);
      if (!place) throw new CommonsRepositoryError(command.kind === "stay" ? "stay_not_found" : "itinerary_not_found", "That place is no longer available.");
      await transaction.update(table).set({ ...placePinColumns(command.pin), updatedAt: new Date() }).where(eq(table.id, place.id));
      await transaction.insert(processedCommands).values({ commonsId: commonsRecord.id, commandId: command.commandId, result: { id: place.id } });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id, commandId: command.commandId, actorId: actor.personId, actorType: "human",
        action: "place.pinned", resourceType: command.kind === "stay" ? "stay" : "itinerary_item", resourceId: place.id,
        summary: command.pin ? `${actor.displayName} saved a map pin for ${place.name}.` : `${actor.displayName} removed the map pin for ${place.name}.`,
      });
    });
    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

async function validateStayContext(
  transaction: Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0],
  commonsId: string,
  actorPersonId: string,
  includedPersonIds: string[],
  pollId: string | null,
) {
  const [actorRow] = await transaction.select({
    personId: people.id,
    displayName: people.displayName,
    role: memberships.role,
    status: memberships.status,
  }).from(memberships)
    .innerJoin(people, eq(memberships.personId, people.id))
    .where(and(
      eq(memberships.commonsId, commonsId),
      eq(memberships.personId, actorPersonId),
    )).limit(1);
  if (!actorRow || actorRow.status !== "active" || actorRow.role !== "organizer") {
    throw new CommonsRepositoryError(
      "actor_not_authorized",
      "Only an organizer can manage stays.",
    );
  }
  const memberRows = await transaction.select({ personId: memberships.personId })
    .from(memberships)
    .where(and(
      eq(memberships.commonsId, commonsId),
      inArray(memberships.status, ["active", "invited"]),
    ));
  const memberIds = new Set(memberRows.map((member) => member.personId));
  if (includedPersonIds.some((personId) => !memberIds.has(personId))) {
    throw new CommonsRepositoryError(
      "actor_not_authorized",
      "A stay can include only people in this trip.",
    );
  }
  if (pollId) {
    const [poll] = await transaction.select({ id: polls.id }).from(polls)
      .where(and(eq(polls.id, pollId), eq(polls.commonsId, commonsId))).limit(1);
    if (!poll) {
      throw new CommonsRepositoryError(
        "actor_not_authorized",
        "Choose a poll from this trip.",
      );
    }
  }
  return actorRow;
}

export async function addCommonsStay(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = AddStayCommandSchema.parse(input);
  if (command.costSource === "expense") {
    throw new CommonsRepositoryError("actor_not_authorized", "Add paid lodging from the expense ledger.");
  }
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db.select({ id: commons.id }).from(commons)
      .where(eq(commons.slug, slug)).limit(1);
    if (!commonsRecord) throw new CommonsRepositoryError("commons_not_found", "Trip not found.");

    await database.db.transaction(async (transaction) => {
      await transaction.select({ id: commons.id }).from(commons)
        .where(eq(commons.id, commonsRecord.id)).for("update");
      const [processed] = await transaction.select({ id: processedCommands.id }).from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        )).limit(1);
      if (processed) return;

      const actor = await validateStayContext(
        transaction,
        commonsRecord.id,
        options.actorPersonId,
        command.includedPersonIds,
        command.pollId,
      );
      if (command.confirmationDocument) {
        assertConfirmationDocumentPath(slug, actor.personId, command.confirmationDocument.storagePath);
        await consumeConfirmationIntake(transaction, commonsRecord.id, actor.personId, command.confirmationDocument);
      }
      const [created] = await transaction.insert(stayRecords).values({
        commonsId: commonsRecord.id,
        createdByPersonId: actor.personId,
        name: command.name,
        address: command.address,
        ...placePinColumns(command.pin),
        startsOn: command.startsOn,
        endsOn: command.endsOn,
        timezone: command.timezone,
        checkInTime: command.checkInTime,
        checkOutTime: command.checkOutTime,
        status: command.status,
        bookingUrl: command.bookingUrl,
        pollId: command.pollId,
        confirmationCode: command.confirmationCode,
        totalCents: command.totalCents,
        ...(command.roomPriceCents !== undefined ? { roomPriceCents: command.roomPriceCents } : {}),
        ...(command.roomCount !== undefined ? { roomCount: command.roomCount } : {}),
        currency: command.currency,
        costSource: command.costSource,
        includesTaxesAndFees: command.includesTaxesAndFees,
        details: command.details,
        sourceLabel: command.confirmationDocument
          ? `From a private confirmation · confirmed by ${actor.displayName.split(" ")[0]}`
          : `Added by ${actor.displayName.split(" ")[0]}`,
      }).returning({ id: stayRecords.id });
      if (command.confirmationDocument) {
        await transaction.insert(confirmationDocuments).values({
          commonsId: commonsRecord.id,
          ownerPersonId: actor.personId,
          storagePath: command.confirmationDocument.storagePath,
          fileName: command.confirmationDocument.fileName,
          mimeType: command.confirmationDocument.mimeType,
          stayId: created.id,
        });
      }
      await transaction.insert(stayParticipants).values(
        command.includedPersonIds.map((personId) => ({ stayId: created.id, personId })),
      );
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { stayId: created.id },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actor.personId,
        actorType: "human",
        action: "stay.added",
        resourceType: "stay",
        resourceId: created.id,
        summary: `${actor.displayName} added ${command.name} as a stay.`,
      });
    });
    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function updateCommonsStay(
  slug: string,
  stayId: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = UpdateStayCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db.select({ id: commons.id }).from(commons)
      .where(eq(commons.slug, slug)).limit(1);
    if (!commonsRecord) throw new CommonsRepositoryError("commons_not_found", "Trip not found.");

    await database.db.transaction(async (transaction) => {
      await transaction.select({ id: commons.id }).from(commons)
        .where(eq(commons.id, commonsRecord.id)).for("update");
      const [processed] = await transaction.select({ id: processedCommands.id }).from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        )).limit(1);
      if (processed) return;
      const [existing] = await transaction.select({ id: stayRecords.id, legacyExpenseId: stayRecords.legacyExpenseId }).from(stayRecords)
        .where(and(eq(stayRecords.commonsId, commonsRecord.id), eq(stayRecords.id, stayId))).limit(1);
      if (!existing) throw new CommonsRepositoryError("stay_not_found", "That stay is no longer available.");
      if (command.costSource === "expense" && !existing.legacyExpenseId) {
        throw new CommonsRepositoryError("actor_not_authorized", "Add paid lodging from the expense ledger.");
      }
      if (existing.legacyExpenseId && command.totalCents === null) {
        throw new CommonsRepositoryError("actor_not_authorized", "Remove the linked expense before clearing the stay cost.");
      }

      const actor = await validateStayContext(
        transaction,
        commonsRecord.id,
        options.actorPersonId,
        command.includedPersonIds,
        command.pollId,
      );
      if (command.confirmationDocument) {
        assertConfirmationDocumentPath(slug, actor.personId, command.confirmationDocument.storagePath);
        await consumeConfirmationIntake(transaction, commonsRecord.id, actor.personId, command.confirmationDocument);
      }
      await transaction.update(stayRecords).set({
        name: command.name,
        address: command.address,
        ...placePinColumns(command.pin),
        startsOn: command.startsOn,
        endsOn: command.endsOn,
        timezone: command.timezone,
        checkInTime: command.checkInTime,
        checkOutTime: command.checkOutTime,
        status: command.status,
        bookingUrl: command.bookingUrl,
        pollId: command.pollId,
        confirmationCode: command.confirmationCode,
        totalCents: command.totalCents,
        ...(command.roomPriceCents !== undefined ? { roomPriceCents: command.roomPriceCents } : {}),
        ...(command.roomCount !== undefined ? { roomCount: command.roomCount } : {}),
        currency: command.currency,
        costSource: command.costSource,
        includesTaxesAndFees: command.includesTaxesAndFees,
        details: command.details,
        sourceLabel: command.confirmationDocument
          ? `From a private confirmation · confirmed by ${actor.displayName.split(" ")[0]}`
          : `Updated by ${actor.displayName.split(" ")[0]}`,
        updatedAt: new Date(),
      }).where(eq(stayRecords.id, stayId));
      if (command.confirmationDocument) {
        await transaction.insert(confirmationDocuments).values({
          commonsId: commonsRecord.id,
          ownerPersonId: actor.personId,
          storagePath: command.confirmationDocument.storagePath,
          fileName: command.confirmationDocument.fileName,
          mimeType: command.confirmationDocument.mimeType,
          stayId,
        }).onConflictDoUpdate({
          target: confirmationDocuments.stayId,
          set: {
            ownerPersonId: actor.personId,
            storagePath: command.confirmationDocument.storagePath,
            fileName: command.confirmationDocument.fileName,
            mimeType: command.confirmationDocument.mimeType,
            updatedAt: new Date(),
          },
        });
      }
      await transaction.delete(stayParticipants).where(eq(stayParticipants.stayId, stayId));
      await transaction.insert(stayParticipants).values(
        command.includedPersonIds.map((personId) => ({ stayId, personId })),
      );
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { stayId },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actor.personId,
        actorType: "human",
        action: "stay.updated",
        resourceType: "stay",
        resourceId: stayId,
        summary: `${actor.displayName} updated ${command.name}.`,
      });
    });
    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function deleteCommonsStay(
  slug: string,
  stayId: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = DeleteStayCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db.select({ id: commons.id }).from(commons)
      .where(eq(commons.slug, slug)).limit(1);
    if (!commonsRecord) throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    await database.db.transaction(async (transaction) => {
      await transaction.select({ id: commons.id }).from(commons)
        .where(eq(commons.id, commonsRecord.id)).for("update");
      const [processed] = await transaction.select({ id: processedCommands.id }).from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        )).limit(1);
      if (processed) return;
      const [existing] = await transaction.select({ id: stayRecords.id, name: stayRecords.name })
        .from(stayRecords)
        .where(and(eq(stayRecords.commonsId, commonsRecord.id), eq(stayRecords.id, stayId))).limit(1);
      if (!existing) throw new CommonsRepositoryError("stay_not_found", "That stay is no longer available.");
      const actor = await validateStayContext(
        transaction,
        commonsRecord.id,
        options.actorPersonId,
        [options.actorPersonId],
        null,
      );
      await transaction.update(confirmationDocuments)
        .set({ stayId: null, updatedAt: new Date() })
        .where(and(eq(confirmationDocuments.stayId, stayId), isNotNull(confirmationDocuments.expenseId)));
      await transaction.delete(stayRecords).where(eq(stayRecords.id, stayId));
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { stayId },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actor.personId,
        actorType: "human",
        action: "stay.deleted",
        resourceType: "stay",
        resourceId: stayId,
        summary: `${actor.displayName} removed ${existing.name} from the stays.`,
      });
    });
    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function addCommonsExpense(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = AddExpenseCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      const [lockedCommons] = await transaction
        .select({
          id: commons.id,
          currency: commons.currency,
          expensesClosedAt: commons.expensesClosedAt,
          balancesDisabled: commons.balancesDisabled,
        })
        .from(commons)
        .where(eq(commons.id, commonsRecord.id))
        .for("update");

      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(
          and(
            eq(processedCommands.commonsId, commonsRecord.id),
            eq(processedCommands.commandId, command.commandId),
          ),
        )
        .limit(1);
      if (alreadyProcessed) return;
      assertExpenseLedgerOpen(lockedCommons?.expensesClosedAt);
      assertExpenseBalanceMode(lockedCommons?.balancesDisabled, command.balanceMode);

      const memberRows = await transaction
        .select({
          personId: people.id,
          displayName: people.displayName,
          status: memberships.status,
          expensesCompleteAt: memberships.expensesCompleteAt,
        })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(
          and(
            eq(memberships.commonsId, commonsRecord.id),
            inArray(memberships.status, ["active", "invited"]),
          ),
        );
      const actorRow = memberRows.find(
        (member) => member.personId === options.actorPersonId,
      );
      if (!actorRow || actorRow.status !== "active") {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "Only an active participant can add an expense.",
        );
      }
      const activeMembers = memberRows.filter((member) => member.status === "active");
      if (
        activeMembers.length > 0 &&
        activeMembers.every((member) => member.expensesCompleteAt !== null)
      ) {
        throw new CommonsRepositoryError(
          "expense_ledger_closed",
          "Everyone marked their expenses complete. Reopen expenses before adding another.",
        );
      }
      const memberIds = new Set(memberRows.map((member) => member.personId));
      if (
        !memberIds.has(command.paidByPersonId) ||
        command.shares.some((share) => !memberIds.has(share.personId))
      ) {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "An expense can include only people in this Commons.",
        );
      }
      const payer = memberRows.find(
        (member) => member.personId === command.paidByPersonId,
      )!;
      if (command.itineraryItemId) {
        const [linkedPlan] = await transaction
          .select({ id: itineraryItems.id })
          .from(itineraryItems)
          .where(and(
            eq(itineraryItems.commonsId, commonsRecord.id),
            eq(itineraryItems.id, command.itineraryItemId),
          ))
          .limit(1);
        if (!linkedPlan) {
          throw new CommonsRepositoryError("itinerary_not_found", "Linked plan not found.");
        }
      }
      let confirmationDocumentId: string | null = null;
      if (command.stayId) {
        const [linkedStay] = await transaction
          .select({
            id: stayRecords.id,
            linkedExpenseId: stayRecords.legacyExpenseId,
          })
          .from(stayRecords)
          .where(and(eq(stayRecords.commonsId, commonsRecord.id), eq(stayRecords.id, command.stayId)))
          .limit(1);
        if (!linkedStay) throw new CommonsRepositoryError("stay_not_found", "Linked stay not found.");
        if (linkedStay.linkedExpenseId) throw new CommonsRepositoryError("actor_not_authorized", "That stay already has a reimbursement expense.");
        const [document] = await transaction.select({ id: confirmationDocuments.id }).from(confirmationDocuments)
          .where(and(eq(confirmationDocuments.stayId, linkedStay.id), eq(confirmationDocuments.ownerPersonId, actorRow.personId))).limit(1);
        confirmationDocumentId = document?.id ?? null;
      }
      if (command.travelPlanId) {
        const [linkedTravel] = await transaction.select({
          id: travelPlans.id,
          linkedExpenseId: travelPlans.legacyExpenseId,
          personId: travelPlans.personId,
        }).from(travelPlans).where(and(eq(travelPlans.commonsId, commonsRecord.id), eq(travelPlans.id, command.travelPlanId))).limit(1);
        if (!linkedTravel) throw new CommonsRepositoryError("travel_plan_not_found", "Linked travel plan not found.");
        if (linkedTravel.personId !== actorRow.personId) throw new CommonsRepositoryError("actor_not_authorized", "Only the owner can record this private travel plan as an expense.");
        if (linkedTravel.linkedExpenseId) throw new CommonsRepositoryError("actor_not_authorized", "That travel plan already has a reimbursement expense.");
        const [document] = await transaction.select({ id: confirmationDocuments.id }).from(confirmationDocuments)
          .where(and(eq(confirmationDocuments.travelPlanId, linkedTravel.id), eq(confirmationDocuments.ownerPersonId, actorRow.personId))).limit(1);
        confirmationDocumentId = document?.id ?? null;
      }

      if (actorRow.expensesCompleteAt) {
        await transaction
          .update(memberships)
          .set({ expensesCompleteAt: null, updatedAt: new Date() })
          .where(and(
            eq(memberships.commonsId, commonsRecord.id),
            eq(memberships.personId, actorRow.personId),
          ));
      }

      const [inserted] = await transaction
        .insert(expenses)
        .values({
          commonsId: commonsRecord.id,
          title: command.title,
          amountCents: command.amountCents,
          currency: command.currency ?? lockedCommons.currency,
          paidByPersonId: command.paidByPersonId,
          createdByPersonId: actorRow.personId,
          occurredOn: command.occurredOn,
          category: command.category,
          itineraryItemId: command.itineraryItemId,
          status: "confirmed",
          splitMethod: command.splitMethod,
          balanceMode: command.balanceMode,
          confirmationCode: command.confirmationCode,
          receiptStatus: confirmationDocumentId ? "attached" : "not_attached",
          source: "web",
          sourceLabel: `Added in Commons by ${actorRow.displayName}`,
          note: command.note || null,
        })
        .returning({ id: expenses.id, createdAt: expenses.createdAt });

      await transaction.insert(expenseShares).values(
        command.shares.map((share) => ({
          expenseId: inserted.id,
          personId: share.personId,
          amountCents: share.amountCents,
        })),
      );
      if (command.stayId) {
        await transaction.update(stayRecords)
          .set({ legacyExpenseId: inserted.id, updatedAt: new Date() })
          .where(eq(stayRecords.id, command.stayId));
      }
      if (command.travelPlanId) {
        await transaction.update(travelPlans)
          .set({ legacyExpenseId: inserted.id, updatedAt: new Date() })
          .where(eq(travelPlans.id, command.travelPlanId));
      }
      if (confirmationDocumentId) {
        await transaction.update(confirmationDocuments)
          .set({ expenseId: inserted.id, updatedAt: new Date() })
          .where(eq(confirmationDocuments.id, confirmationDocumentId));
      }
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { expenseId: inserted.id },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "expense.added",
        resourceType: "expense",
        resourceId: inserted.id,
        summary: `${actorRow.displayName} added ${command.title}; ${payer.displayName} paid.`,
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function updateCommonsExpense(
  slug: string,
  expenseId: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = UpdateExpenseCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      const [lockedCommons] = await transaction
        .select({
          id: commons.id,
          expensesClosedAt: commons.expensesClosedAt,
          balancesDisabled: commons.balancesDisabled,
        })
        .from(commons)
        .where(eq(commons.id, commonsRecord.id))
        .for("update");

      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(
          and(
            eq(processedCommands.commonsId, commonsRecord.id),
            eq(processedCommands.commandId, command.commandId),
          ),
        )
        .limit(1);
      if (alreadyProcessed) return;
      assertExpenseLedgerOpen(lockedCommons?.expensesClosedAt);
      assertExpenseBalanceMode(lockedCommons?.balancesDisabled, command.balanceMode);

      const [expenseRecord] = await transaction
        .select({ id: expenses.id, currency: expenses.currency, sourceLabel: expenses.sourceLabel })
        .from(expenses)
        .where(
          and(
            eq(expenses.commonsId, commonsRecord.id),
            eq(expenses.id, expenseId),
          ),
        )
        .for("update")
        .limit(1);
      if (!expenseRecord) {
        throw new CommonsRepositoryError("expense_not_found", "Expense not found.");
      }

      const memberRows = await transaction
        .select({
          personId: people.id,
          displayName: people.displayName,
          status: memberships.status,
        })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(
          and(
            eq(memberships.commonsId, commonsRecord.id),
            inArray(memberships.status, ["active", "invited"]),
          ),
        );
      const actorRow = memberRows.find(
        (member) => member.personId === options.actorPersonId,
      );
      if (!actorRow || actorRow.status !== "active") {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "Only an active participant can edit an expense.",
        );
      }
      const memberIds = new Set(memberRows.map((member) => member.personId));
      if (
        !memberIds.has(command.paidByPersonId) ||
        command.shares.some((share) => !memberIds.has(share.personId))
      ) {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "An expense can include only people in this Commons.",
        );
      }
      if (command.currency && command.currency !== expenseRecord.currency) {
        throw new CommonsRepositoryError("actor_not_authorized", "The saved currency cannot be changed. Add a separate record in the correct currency.");
      }
      const originalSource = expenseRecord.sourceLabel.replace(/ · Updated by .+$/, "");
      if (command.itineraryItemId) {
        const [linkedPlan] = await transaction
          .select({ id: itineraryItems.id })
          .from(itineraryItems)
          .where(and(
            eq(itineraryItems.commonsId, commonsRecord.id),
            eq(itineraryItems.id, command.itineraryItemId),
          ))
          .limit(1);
        if (!linkedPlan) {
          throw new CommonsRepositoryError("itinerary_not_found", "Linked plan not found.");
        }
      }

      if (command.stayId) {
        const [linkedStay] = await transaction
          .select({ id: stayRecords.id, linkedExpenseId: stayRecords.legacyExpenseId })
          .from(stayRecords)
          .where(and(eq(stayRecords.commonsId, commonsRecord.id), eq(stayRecords.id, command.stayId)))
          .limit(1);
        if (!linkedStay) throw new CommonsRepositoryError("stay_not_found", "Linked stay not found.");
        if (linkedStay.linkedExpenseId && linkedStay.linkedExpenseId !== expenseRecord.id) {
          throw new CommonsRepositoryError("actor_not_authorized", "That stay already has a reimbursement expense.");
        }
      }
      if (command.travelPlanId) {
        const [linkedTravel] = await transaction
          .select({ id: travelPlans.id, personId: travelPlans.personId, linkedExpenseId: travelPlans.legacyExpenseId })
          .from(travelPlans)
          .where(and(eq(travelPlans.commonsId, commonsRecord.id), eq(travelPlans.id, command.travelPlanId)))
          .limit(1);
        if (!linkedTravel) throw new CommonsRepositoryError("travel_plan_not_found", "Linked travel plan not found.");
        if (linkedTravel.personId !== actorRow.personId) throw new CommonsRepositoryError("actor_not_authorized", "Only the owner can link this private travel plan.");
        if (linkedTravel.linkedExpenseId && linkedTravel.linkedExpenseId !== expenseRecord.id) {
          throw new CommonsRepositoryError("actor_not_authorized", "That travel plan already has a reimbursement expense.");
        }
      }

      await transaction
        .update(expenses)
        .set({
          title: command.title,
          amountCents: command.amountCents,
          paidByPersonId: command.paidByPersonId,
          occurredOn: command.occurredOn,
          category: command.category,
          itineraryItemId: command.itineraryItemId,
          splitMethod: command.splitMethod,
          balanceMode: command.balanceMode,
          confirmationCode: command.confirmationCode,
          sourceLabel: `${originalSource} · Updated by ${actorRow.displayName}`,
          note: command.note || null,
          updatedAt: new Date(),
        })
        .where(eq(expenses.id, expenseRecord.id));
      await transaction.update(stayRecords)
        .set({
          legacyExpenseId: null,
          costSource: sql`CASE WHEN ${stayRecords.costSource} = 'expense' THEN 'estimate' ELSE ${stayRecords.costSource} END`,
          updatedAt: new Date(),
        })
        .where(eq(stayRecords.legacyExpenseId, expenseRecord.id));
      await transaction.update(travelPlans)
        .set({ legacyExpenseId: null, updatedAt: new Date() })
        .where(eq(travelPlans.legacyExpenseId, expenseRecord.id));
      if (command.stayId) {
        await transaction.update(stayRecords)
          .set({ legacyExpenseId: expenseRecord.id, updatedAt: new Date() })
          .where(eq(stayRecords.id, command.stayId));
      }
      if (command.travelPlanId) {
        await transaction.update(travelPlans)
          .set({ legacyExpenseId: expenseRecord.id, updatedAt: new Date() })
          .where(eq(travelPlans.id, command.travelPlanId));
      }
      await transaction
        .delete(expenseShares)
        .where(eq(expenseShares.expenseId, expenseRecord.id));
      await transaction.insert(expenseShares).values(
        command.shares.map((share) => ({
          expenseId: expenseRecord.id,
          personId: share.personId,
          amountCents: share.amountCents,
        })),
      );
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { expenseId: expenseRecord.id },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "expense.updated",
        resourceType: "expense",
        resourceId: expenseRecord.id,
        summary: `${actorRow.displayName} updated ${command.title}.`,
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function deleteCommonsExpense(
  slug: string,
  expenseId: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = DeleteExpenseCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      const [lockedCommons] = await transaction
        .select({ id: commons.id, expensesClosedAt: commons.expensesClosedAt })
        .from(commons)
        .where(eq(commons.id, commonsRecord.id))
        .for("update");

      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(
          and(
            eq(processedCommands.commonsId, commonsRecord.id),
            eq(processedCommands.commandId, command.commandId),
          ),
        )
        .limit(1);
      if (alreadyProcessed) return;
      assertExpenseLedgerOpen(lockedCommons?.expensesClosedAt);

      const [expenseRecord] = await transaction
        .select({ id: expenses.id, title: expenses.title })
        .from(expenses)
        .where(
          and(
            eq(expenses.commonsId, commonsRecord.id),
            eq(expenses.id, expenseId),
          ),
        )
        .for("update")
        .limit(1);
      if (!expenseRecord) {
        throw new CommonsRepositoryError("expense_not_found", "Expense not found.");
      }

      const [actorRow] = await transaction
        .select({
          personId: people.id,
          displayName: people.displayName,
          status: memberships.status,
        })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(
          and(
            eq(memberships.commonsId, commonsRecord.id),
            eq(people.id, options.actorPersonId),
          ),
        )
        .limit(1);
      if (!actorRow || actorRow.status !== "active") {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "Only an active participant can delete an expense.",
        );
      }

      await transaction.update(stayRecords)
        .set({
          legacyExpenseId: null,
          costSource: sql`CASE WHEN ${stayRecords.costSource} = 'expense' THEN 'estimate' ELSE ${stayRecords.costSource} END`,
          updatedAt: new Date(),
        })
        .where(eq(stayRecords.legacyExpenseId, expenseRecord.id));
      await transaction.update(travelPlans)
        .set({ legacyExpenseId: null, updatedAt: new Date() })
        .where(eq(travelPlans.legacyExpenseId, expenseRecord.id));
      await transaction.delete(confirmationDocuments)
        .where(and(
          eq(confirmationDocuments.expenseId, expenseRecord.id),
          isNull(confirmationDocuments.stayId),
          isNull(confirmationDocuments.travelPlanId),
        ));
      await transaction.update(confirmationDocuments)
        .set({ expenseId: null, updatedAt: new Date() })
        .where(eq(confirmationDocuments.expenseId, expenseRecord.id));
      await transaction.delete(expenses).where(eq(expenses.id, expenseRecord.id));
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { expenseId: expenseRecord.id, deleted: true },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "expense.deleted",
        resourceType: "expense",
        resourceId: expenseRecord.id,
        summary: `${actorRow.displayName} deleted ${expenseRecord.title}.`,
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function addCommonsReimbursement(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = AddReimbursementCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      const [lockedCommons] = await transaction.select({ id: commons.id, currency: commons.currency, expensesClosedAt: commons.expensesClosedAt }).from(commons)
        .where(eq(commons.id, commonsRecord.id)).for("update");

      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        ))
        .limit(1);
      if (alreadyProcessed) return;
      assertExpenseLedgerOpen(lockedCommons?.expensesClosedAt);

      const memberRows = await transaction
        .select({
          personId: people.id,
          displayName: people.displayName,
          status: memberships.status,
        })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(and(
          eq(memberships.commonsId, commonsRecord.id),
          inArray(memberships.status, ["active", "invited"]),
        ));
      const actorRow = memberRows.find((member) => member.personId === options.actorPersonId);
      if (!actorRow || actorRow.status !== "active") {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "Only an active participant can record a payment.",
        );
      }
      const sender = memberRows.find((member) => member.personId === command.fromPersonId);
      const recipient = memberRows.find((member) => member.personId === command.toPersonId);
      if (!sender || !recipient) {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "A payment can include only people in this Commons.",
        );
      }

      const [inserted] = await transaction.insert(reimbursements).values({
        commonsId: commonsRecord.id,
        fromPersonId: command.fromPersonId,
        toPersonId: command.toPersonId,
        amountCents: command.amountCents,
        currency: command.currency ?? lockedCommons.currency,
        occurredOn: command.occurredOn,
        source: "web",
        sourceLabel: `Recorded in Commons by ${actorRow.displayName}`,
      }).returning({ id: reimbursements.id });

      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { reimbursementId: inserted.id },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "reimbursement.added",
        resourceType: "reimbursement",
        resourceId: inserted.id,
        summary: `${actorRow.displayName} recorded ${sender.displayName} paying ${recipient.displayName}.`,
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function updateCommonsReimbursement(
  slug: string,
  reimbursementId: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = UpdateReimbursementCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      const [lockedCommons] = await transaction.select({ id: commons.id, expensesClosedAt: commons.expensesClosedAt }).from(commons)
        .where(eq(commons.id, commonsRecord.id)).for("update");

      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        ))
        .limit(1);
      if (alreadyProcessed) return;
      assertExpenseLedgerOpen(lockedCommons?.expensesClosedAt);

      const [reimbursementRecord] = await transaction
        .select({ id: reimbursements.id, currency: reimbursements.currency, sourceLabel: reimbursements.sourceLabel })
        .from(reimbursements)
        .where(and(
          eq(reimbursements.commonsId, commonsRecord.id),
          eq(reimbursements.id, reimbursementId),
        ))
        .for("update")
        .limit(1);
      if (!reimbursementRecord) {
        throw new CommonsRepositoryError("reimbursement_not_found", "Payment not found.");
      }

      const memberRows = await transaction
        .select({
          personId: people.id,
          displayName: people.displayName,
          status: memberships.status,
        })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(and(
          eq(memberships.commonsId, commonsRecord.id),
          inArray(memberships.status, ["active", "invited"]),
        ));
      const actorRow = memberRows.find((member) => member.personId === options.actorPersonId);
      if (!actorRow || actorRow.status !== "active") {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "Only an active participant can edit a payment.",
        );
      }
      const sender = memberRows.find((member) => member.personId === command.fromPersonId);
      const recipient = memberRows.find((member) => member.personId === command.toPersonId);
      if (!sender || !recipient) {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "A payment can include only people in this Commons.",
        );
      }
      if (command.currency && command.currency !== reimbursementRecord.currency) {
        throw new CommonsRepositoryError("actor_not_authorized", "The saved currency cannot be changed. Add a separate record in the correct currency.");
      }
      const originalSource = reimbursementRecord.sourceLabel.replace(/ · Updated by .+$/, "");

      await transaction.update(reimbursements).set({
        fromPersonId: command.fromPersonId,
        toPersonId: command.toPersonId,
        amountCents: command.amountCents,
        occurredOn: command.occurredOn,
        sourceLabel: `${originalSource} · Updated by ${actorRow.displayName}`,
        updatedAt: new Date(),
      }).where(eq(reimbursements.id, reimbursementRecord.id));
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { reimbursementId: reimbursementRecord.id },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "reimbursement.updated",
        resourceType: "reimbursement",
        resourceId: reimbursementRecord.id,
        summary: `${actorRow.displayName} updated ${sender.displayName}’s payment to ${recipient.displayName}.`,
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function deleteCommonsReimbursement(
  slug: string,
  reimbursementId: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = DeleteReimbursementCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      const [lockedCommons] = await transaction.select({ id: commons.id, expensesClosedAt: commons.expensesClosedAt }).from(commons)
        .where(eq(commons.id, commonsRecord.id)).for("update");

      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        ))
        .limit(1);
      if (alreadyProcessed) return;
      assertExpenseLedgerOpen(lockedCommons?.expensesClosedAt);

      const [reimbursementRecord] = await transaction
        .select({
          id: reimbursements.id,
          fromPersonId: reimbursements.fromPersonId,
          toPersonId: reimbursements.toPersonId,
          amountCents: reimbursements.amountCents,
        })
        .from(reimbursements)
        .where(and(
          eq(reimbursements.commonsId, commonsRecord.id),
          eq(reimbursements.id, reimbursementId),
        ))
        .for("update")
        .limit(1);
      if (!reimbursementRecord) {
        throw new CommonsRepositoryError("reimbursement_not_found", "Payment not found.");
      }

      const memberRows = await transaction
        .select({ personId: people.id, displayName: people.displayName, status: memberships.status })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(and(
          eq(memberships.commonsId, commonsRecord.id),
          inArray(memberships.status, ["active", "invited"]),
        ));
      const actorRow = memberRows.find((member) => member.personId === options.actorPersonId);
      if (!actorRow || actorRow.status !== "active") {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "Only an active participant can delete a payment.",
        );
      }
      const senderName = memberRows.find((member) => member.personId === reimbursementRecord.fromPersonId)?.displayName ?? "A participant";
      const recipientName = memberRows.find((member) => member.personId === reimbursementRecord.toPersonId)?.displayName ?? "another participant";

      await transaction.delete(reimbursements).where(eq(reimbursements.id, reimbursementRecord.id));
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { reimbursementId: reimbursementRecord.id, deleted: true },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "reimbursement.deleted",
        resourceType: "reimbursement",
        resourceId: reimbursementRecord.id,
        summary: `${actorRow.displayName} deleted ${senderName}’s payment to ${recipientName}.`,
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function confirmCommonsExpensesComplete(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = ConfirmExpensesCompleteCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      await transaction
        .select({ id: commons.id })
        .from(commons)
        .where(eq(commons.id, commonsRecord.id))
        .for("update");

      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        ))
        .limit(1);
      if (alreadyProcessed) return;

      const [actorRow] = await transaction
        .select({
          personId: people.id,
          displayName: people.displayName,
          status: memberships.status,
          role: memberships.role,
        })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(and(
          eq(memberships.commonsId, commonsRecord.id),
          eq(memberships.personId, options.actorPersonId),
        ))
        .limit(1);
      if (!actorRow || actorRow.status !== "active") {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "Only an active participant can mark their expenses complete.",
        );
      }

      if (command.scope === "group" && actorRow.role !== "organizer") {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "Only an organizer can close expenses for the group.",
        );
      }

      const confirmedAt = new Date();
      if (command.scope === "group") {
        await transaction
          .update(commons)
          .set({
            expensesClosedAt: confirmedAt,
            expensesClosedByPersonId: actorRow.personId,
            updatedAt: confirmedAt,
          })
          .where(eq(commons.id, commonsRecord.id));
      } else {
        await transaction
          .update(memberships)
          .set({ expensesCompleteAt: confirmedAt, updatedAt: confirmedAt })
          .where(and(
            eq(memberships.commonsId, commonsRecord.id),
            eq(memberships.personId, actorRow.personId),
          ));
      }
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { personId: actorRow.personId, scope: command.scope, expensesCompleteAt: confirmedAt.toISOString() },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: command.scope === "group" ? "expenses.closed" : "expenses.completed",
        resourceType: command.scope === "group" ? "commons" : "membership",
        resourceId: command.scope === "group" ? commonsRecord.id : actorRow.personId,
        summary: command.scope === "group"
          ? `${actorRow.displayName} closed expenses for the group.`
          : `${actorRow.displayName} marked their expenses complete.`,
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function reopenCommonsExpenses(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = ReopenExpensesCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      await transaction
        .select({ id: commons.id })
        .from(commons)
        .where(eq(commons.id, commonsRecord.id))
        .for("update");

      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        ))
        .limit(1);
      if (alreadyProcessed) return;

      const [actorRow] = await transaction
        .select({
          personId: people.id,
          displayName: people.displayName,
          status: memberships.status,
          role: memberships.role,
        })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(and(
          eq(memberships.commonsId, commonsRecord.id),
          eq(memberships.personId, options.actorPersonId),
        ))
        .limit(1);
      if (!actorRow || actorRow.status !== "active" || actorRow.role !== "organizer") {
        throw new CommonsRepositoryError(
          "actor_not_authorized",
          "Only an organizer can reopen expenses.",
        );
      }

      const reopenedAt = new Date();
      await transaction
        .update(memberships)
        .set({ expensesCompleteAt: null, updatedAt: reopenedAt })
        .where(and(
          eq(memberships.commonsId, commonsRecord.id),
          eq(memberships.status, "active"),
        ));
      await transaction
        .update(commons)
        .set({
          expensesClosedAt: null,
          expensesClosedByPersonId: null,
          updatedAt: reopenedAt,
        })
        .where(eq(commons.id, commonsRecord.id));
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { reopened: true },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "expenses.reopened",
        resourceType: "commons",
        resourceId: commonsRecord.id,
        summary: `${actorRow.displayName} reopened expenses for the group.`,
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

async function requireActivityArranger(transaction: CommandTransaction, commonsId: string, personId: string | null | undefined) {
  if (!personId) return null;
  const [person] = await transaction.select({ displayName: people.displayName })
    .from(memberships).innerJoin(people, eq(people.id, memberships.personId))
    .where(and(eq(memberships.commonsId, commonsId), eq(memberships.personId, personId),
      eq(memberships.status, "active"), eq(memberships.accessMode, "account"))).limit(1);
  if (!person) throw new CommonsRepositoryError("actor_not_authorized", "Choose an active participant to arrange this activity.");
  return person.displayName;
}

export async function addCommonsItineraryItem(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = AddItineraryItemCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id, timezone: commons.timezone })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(transaction => addCommonsItineraryItemInTransaction(transaction, commonsRecord, slug, command, options));

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function addCommonsItineraryItemInTransaction(transaction: CommandTransaction, commonsRecord: { id: string; timezone: string }, slug: string, input: unknown, options: PilotRepositoryOptions) {
  const command = AddItineraryItemCommandSchema.parse(input);
      const [lockedCommons] = await transaction.select({ id: commons.id, currency: commons.currency }).from(commons)
        .where(eq(commons.id, commonsRecord.id)).for("update");

      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        ))
        .limit(1);
      if (alreadyProcessed) return;

      const [actorRow] = await transaction
        .select({ personId: people.id, displayName: people.displayName, status: memberships.status })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(and(
          eq(memberships.commonsId, commonsRecord.id),
          eq(memberships.personId, options.actorPersonId),
        ))
        .limit(1);
      if (!actorRow || actorRow.status !== "active") {
        throw new CommonsRepositoryError("actor_not_authorized", "Only an active participant can add a plan.");
      }

      const arrangerName = await requireActivityArranger(transaction, commonsRecord.id, command.arrangerPersonId);
      const justMe = command.participantScope === "self";
      const expectedParticipantIds = justMe ? [actorRow.personId] : [...new Set(command.expectedParticipantIds)];
      if (expectedParticipantIds.length) {
        const expectedMembers = await transaction
          .select({ personId: memberships.personId })
          .from(memberships)
          .where(and(
            eq(memberships.commonsId, commonsRecord.id),
            eq(memberships.status, "active"),
            inArray(memberships.personId, expectedParticipantIds),
          ));
        if (expectedMembers.length !== expectedParticipantIds.length) {
          throw new CommonsRepositoryError("actor_not_authorized", "Every expected traveler must be an active participant in this Commons.");
        }
      }

      const startsAt = command.date && command.time
        ? localDateTimeToDate(command.date, command.time, commonsRecord.timezone)
        : null;
      const [item] = await transaction
        .insert(itineraryItems)
        .values({
          commonsId: commonsRecord.id,
          title: command.title,
          arrangerPersonId: command.arrangerPersonId ?? null,
          startsAt,
          scheduledDate: command.date,
          durationMinutes: command.durationMinutes ?? null,
          endsAt: startsAt && command.durationMinutes ? new Date(startsAt.valueOf() + command.durationMinutes * 60_000) : null,
          timezone: commonsRecord.timezone,
          locationName: command.location || null,
          ...placePinColumns(command.pin),
          audience: command.participantScope === "self" ? "subgroup" : command.participantScope === "optional" ? "individual" : command.participantScope,
          status: command.status ?? (command.date ? "planned" : "idea"),
          expectedCostCents: command.expectedCostCents,
          expectedCostCurrency: command.expectedCostCurrency ?? lockedCommons.currency,
          expectedCostBasis: command.expectedCostBasis,
          note: command.note || null,
          sourceUrl: command.sourceUrl ?? null,
          mealType: command.mealType ?? null,
          provenanceLabel: command.sourceUrl
            ? `${actorRow.displayName} shared this from ${new URL(command.sourceUrl).hostname.replace(/^www\./, "")}`
            : `${actorRow.displayName} added this in Commons`,
        })
        .returning({ id: itineraryItems.id });
      if (command.mealReservation && command.mealType !== "restaurant") throw new CommonsRepositoryError("itinerary_conflict", "Reservation details require a restaurant meal.");
      await saveMealReservation(transaction, item.id, options.actorPersonId, command.mealReservation);

      if (expectedParticipantIds.length) {
        await transaction.insert(participation).values(expectedParticipantIds.map((personId) => ({
          itineraryItemId: item.id,
          personId,
          status: justMe ? "in" as const : "maybe" as const,
          source: justMe ? "web" : "plan_estimate",
        })));
      }

      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { itineraryItemId: item.id },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "itinerary.added",
        resourceType: "itinerary_item",
        resourceId: item.id,
        summary: `${actorRow.displayName} added ${startsAt ? command.title : `${command.title} as an idea`}${justMe ? " for themselves" : ""}.${arrangerName ? ` Being arranged by ${arrangerName}.` : ""}`,
        occurredAt: new Date(command.occurredAt),
      });
}

async function saveMealReservation(tx: CommandTransaction, itemId: string, personId: string, value: { number: string; note: string } | null | undefined) {
  if (value === undefined) return;
  if (!value || (!value.number && !value.note)) {
    await tx.delete(mealReservations).where(and(eq(mealReservations.itineraryItemId, itemId), eq(mealReservations.personId, personId)));
    return;
  }
  await tx.insert(mealReservations).values({ itineraryItemId: itemId, personId, confirmationNumber: value.number, note: value.note })
    .onConflictDoUpdate({ target: [mealReservations.itineraryItemId, mealReservations.personId], set: { confirmationNumber: value.number, note: value.note, updatedAt: new Date() } });
}

export async function updateCommonsItineraryItem(
  slug: string,
  itineraryItemId: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = UpdateItineraryItemCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id, timezone: commons.timezone })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      await transaction.select({ id: commons.id }).from(commons)
        .where(eq(commons.id, commonsRecord.id)).for("update");

      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        ))
        .limit(1);
      if (alreadyProcessed) return;

      const [actorRow] = await transaction
        .select({ personId: people.id, displayName: people.displayName, status: memberships.status })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(and(
          eq(memberships.commonsId, commonsRecord.id),
          eq(memberships.personId, options.actorPersonId),
        ))
        .limit(1);
      if (!actorRow || actorRow.status !== "active") {
        throw new CommonsRepositoryError("actor_not_authorized", "Only an active participant can edit a plan.");
      }

      const justMe = command.participantScope === "self";
      const expectedParticipantIds = justMe ? [actorRow.personId] : [...new Set(command.expectedParticipantIds)];
      if (expectedParticipantIds.length) {
        const expectedMembers = await transaction
          .select({ personId: memberships.personId })
          .from(memberships)
          .where(and(
            eq(memberships.commonsId, commonsRecord.id),
            eq(memberships.status, "active"),
            inArray(memberships.personId, expectedParticipantIds),
          ));
        if (expectedMembers.length !== expectedParticipantIds.length) {
          throw new CommonsRepositoryError("actor_not_authorized", "Every expected traveler must be an active participant in this Commons.");
        }
      }

      const [item] = await transaction
        .select()
        .from(itineraryItems)
        .where(and(
          eq(itineraryItems.commonsId, commonsRecord.id),
          eq(itineraryItems.id, itineraryItemId),
        ))
        .for("update")
        .limit(1);
      if (!item) {
        throw new CommonsRepositoryError("itinerary_not_found", "Plan not found.");
      }

      if (command.mealReservation && (command.mealType === undefined ? item.mealType : command.mealType) !== "restaurant") throw new CommonsRepositoryError("itinerary_conflict", "Reservation details require a restaurant meal.");
      await saveMealReservation(transaction, item.id, options.actorPersonId, command.mealReservation);
      let arrangerName: string | null = null;
      if (command.arrangerPersonId !== undefined) {
        if (command.expectedArrangerPersonId !== item.arrangerPersonId) {
          throw new CommonsRepositoryError("itinerary_conflict", "The arranger changed. Reopen this activity and review before saving.");
        }
        arrangerName = await requireActivityArranger(transaction, commonsRecord.id, command.arrangerPersonId);
      }
      const existingParticipation = await transaction
        .select()
        .from(participation)
        .where(eq(participation.itineraryItemId, item.id));
      if (command.participantScope === "subgroup") {
        const activeParticipants = await transaction.select({ personId: memberships.personId }).from(memberships)
          .where(and(eq(memberships.commonsId, commonsRecord.id), eq(memberships.status, "active")));
        if (existingParticipation.some((entry) => entry.source !== "plan_estimate" && entry.status !== "skip" && activeParticipants.some((member) => member.personId === entry.personId) && !expectedParticipantIds.includes(entry.personId))) {
          throw new CommonsRepositoryError("itinerary_conflict", "Someone has responded to this plan. Reopen it to keep their response, or add a separate plan.");
        }
        if (existingParticipation.some((entry) => entry.status === "skip" && expectedParticipantIds.includes(entry.personId))) {
          throw new CommonsRepositoryError("itinerary_conflict", "Someone you selected has skipped this plan. They need to change their response before you include them.");
        }
      }
      if (justMe && existingParticipation.some((entry) => entry.personId !== actorRow.personId && entry.source !== "plan_estimate" && entry.status !== "skip")) {
        throw new CommonsRepositoryError("actor_not_authorized", "Other travelers have responded to this plan. Add a separate plan for just you.");
      }

      const startsAt = command.date && command.time
        ? localDateTimeToDate(command.date, command.time, commonsRecord.timezone)
        : null;
      const durationMinutes = command.durationMinutes === undefined
        ? itineraryDurationMinutes({ durationMinutes: item.durationMinutes, startsAt: item.startsAt?.toISOString(), endsAt: item.endsAt?.toISOString() })
        : command.durationMinutes;
      const endTime = itineraryEndTime(startsAt?.toISOString() ?? null, durationMinutes);
      const endsAt = endTime ? new Date(endTime) : null;
      const originalSource = item.provenanceLabel.replace(/ · Updated by .+$/, "");
      await transaction
        .update(itineraryItems)
        .set({
          title: command.title,
          arrangerPersonId: command.arrangerPersonId === undefined ? item.arrangerPersonId : command.arrangerPersonId,
          startsAt,
          scheduledDate: command.date,
          endsAt,
          durationMinutes,
          locationName: command.location || null,
          ...placePinColumns(command.pin),
          audience: command.participantScope === "self" ? "subgroup" : command.participantScope === "optional" ? "individual" : command.participantScope,
          note: command.note || null,
          status: command.status ?? item.status,
          expectedCostCents: command.expectedCostCents,
          expectedCostCurrency: command.expectedCostCurrency,
          expectedCostBasis: command.expectedCostBasis,
          sourceUrl: command.sourceUrl === undefined ? item.sourceUrl : command.sourceUrl,
          mealType: command.mealType === undefined ? item.mealType : command.mealType,
          provenanceLabel: `${originalSource} · Updated by ${actorRow.displayName}`,
          updatedAt: new Date(),
        })
        .where(eq(itineraryItems.id, item.id));

      for (const entry of existingParticipation) {
        if (entry.source === "plan_estimate" && !expectedParticipantIds.includes(entry.personId)) {
          await transaction.delete(participation).where(eq(participation.id, entry.id));
        }
      }
      for (const personId of expectedParticipantIds) {
        const existing = existingParticipation.find((entry) => entry.personId === personId);
        if (!justMe && existing && existing.source !== "plan_estimate") continue;
        await transaction.insert(participation).values({
          itineraryItemId: item.id,
          personId,
          status: justMe ? "in" : "maybe",
          source: justMe ? "web" : "plan_estimate",
        }).onConflictDoUpdate({
          target: [participation.itineraryItemId, participation.personId],
          set: {
            status: justMe ? "in" : "maybe",
            source: justMe ? "web" : "plan_estimate",
            revision: sql`${participation.revision} + 1`,
            updatedAt: new Date(),
          },
        });
      }
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { itineraryItemId: item.id },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "itinerary.updated",
        resourceType: "itinerary_item",
        resourceId: item.id,
        summary: `${actorRow.displayName} updated ${command.title}${justMe ? " for themselves" : ""}.${command.arrangerPersonId !== undefined && command.arrangerPersonId !== item.arrangerPersonId ? arrangerName ? ` Being arranged by ${arrangerName}.` : " Arranger cleared." : ""}`,
        occurredAt: new Date(command.occurredAt),
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function deleteCommonsItineraryItem(
  slug: string,
  itineraryItemId: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = DeleteItineraryItemCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      await transaction.select({ id: commons.id }).from(commons)
        .where(eq(commons.id, commonsRecord.id)).for("update");
      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        ))
        .limit(1);
      if (alreadyProcessed) return;

      const [actorRow] = await transaction
        .select({ personId: people.id, displayName: people.displayName, status: memberships.status })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(and(
          eq(memberships.commonsId, commonsRecord.id),
          eq(memberships.personId, options.actorPersonId),
        ))
        .limit(1);
      if (!actorRow || actorRow.status !== "active") {
        throw new CommonsRepositoryError("actor_not_authorized", "Only an active participant can delete a plan.");
      }

      const [item] = await transaction
        .select({ id: itineraryItems.id, title: itineraryItems.title })
        .from(itineraryItems)
        .where(and(
          eq(itineraryItems.commonsId, commonsRecord.id),
          eq(itineraryItems.id, itineraryItemId),
        ))
        .for("update")
        .limit(1);
      if (!item) {
        throw new CommonsRepositoryError("itinerary_not_found", "Plan not found.");
      }

      await transaction.delete(itineraryItems).where(eq(itineraryItems.id, item.id));
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { itineraryItemId: item.id, deleted: true },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "itinerary.deleted",
        resourceType: "itinerary_item",
        resourceId: item.id,
        summary: `${actorRow.displayName} deleted ${item.title}.`,
        occurredAt: new Date(command.occurredAt),
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function updateCommonsParticipation(
  slug: string,
  itineraryItemId: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = UpdateParticipationCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }

    await database.db.transaction(async (transaction) => {
      await transaction.select({ id: commons.id }).from(commons)
        .where(eq(commons.id, commonsRecord.id)).for("update");
      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        ))
        .limit(1);
      if (alreadyProcessed) return;

      const [actorRow] = await transaction
        .select({ personId: people.id, displayName: people.displayName, status: memberships.status })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(and(
          eq(memberships.commonsId, commonsRecord.id),
          eq(memberships.personId, options.actorPersonId),
        ))
        .limit(1);
      if (!actorRow || actorRow.status !== "active") {
        throw new CommonsRepositoryError("actor_not_authorized", "Only an active participant can respond to a plan.");
      }

      const [item] = await transaction
        .select({ id: itineraryItems.id, title: itineraryItems.title, startsAt: itineraryItems.startsAt })
        .from(itineraryItems)
        .where(and(
          eq(itineraryItems.commonsId, commonsRecord.id),
          eq(itineraryItems.id, itineraryItemId),
        ))
        .for("update")
        .limit(1);
      if (!item) {
        throw new CommonsRepositoryError("itinerary_not_found", "Plan not found.");
      }

      if (command.response === "in") {
        const sameTimeItems = item.startsAt
          ? await transaction
            .select({ id: itineraryItems.id })
            .from(itineraryItems)
            .where(and(
              eq(itineraryItems.commonsId, commonsRecord.id),
              eq(itineraryItems.startsAt, item.startsAt),
            ))
          : [{ id: item.id }];
        for (const sameTimeItem of sameTimeItems) {
          await transaction.insert(participation).values({
            itineraryItemId: sameTimeItem.id,
            personId: actorRow.personId,
            status: sameTimeItem.id === item.id ? "in" : "skip",
            source: "web",
          }).onConflictDoUpdate({
            target: [participation.itineraryItemId, participation.personId],
            set: {
              status: sameTimeItem.id === item.id ? "in" : "skip",
              source: "web",
              revision: sql`${participation.revision} + 1`,
              updatedAt: new Date(),
            },
          });
        }
      } else {
        await transaction.insert(participation).values({
          itineraryItemId: item.id,
          personId: actorRow.personId,
          status: command.response,
          source: "web",
        }).onConflictDoUpdate({
          target: [participation.itineraryItemId, participation.personId],
          set: {
            status: command.response,
            source: "web",
            revision: sql`${participation.revision} + 1`,
            updatedAt: new Date(),
          },
        });
      }

      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { itineraryItemId: item.id, response: command.response },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "participation.updated",
        resourceType: "itinerary_item",
        resourceId: item.id,
        summary: `${actorRow.displayName} responded ${command.response} to ${item.title}.`,
        occurredAt: new Date(command.occurredAt),
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

export async function addCommonsMoment(
  slug: string,
  input: unknown,
  options: PilotRepositoryOptions,
) {
  const command = AddMomentCommandSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    const [commonsRecord] = await database.db
      .select({ id: commons.id })
      .from(commons)
      .where(eq(commons.slug, slug))
      .limit(1);
    if (!commonsRecord) {
      throw new CommonsRepositoryError("commons_not_found", "Trip not found.");
    }
    if (!command.storagePath.startsWith(`${slug}/${command.id}.`)) {
      throw new CommonsRepositoryError("actor_not_authorized", "Photo storage path is not valid for this Commons.");
    }

    await database.db.transaction(async (transaction) => {
      await transaction.select({ id: commons.id }).from(commons)
        .where(eq(commons.id, commonsRecord.id)).for("update");
      const [alreadyProcessed] = await transaction
        .select({ commandId: processedCommands.commandId })
        .from(processedCommands)
        .where(and(
          eq(processedCommands.commonsId, commonsRecord.id),
          eq(processedCommands.commandId, command.commandId),
        ))
        .limit(1);
      if (alreadyProcessed) return;

      const [actorRow] = await transaction
        .select({ personId: people.id, displayName: people.displayName, status: memberships.status })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(and(
          eq(memberships.commonsId, commonsRecord.id),
          eq(memberships.personId, options.actorPersonId),
        ))
        .limit(1);
      if (!actorRow || actorRow.status !== "active") {
        throw new CommonsRepositoryError("actor_not_authorized", "Only an active participant can add a photo.");
      }
      if (command.itineraryItemId) {
        const [linkedItem] = await transaction
          .select({ id: itineraryItems.id })
          .from(itineraryItems)
          .where(and(
            eq(itineraryItems.commonsId, commonsRecord.id),
            eq(itineraryItems.id, command.itineraryItemId),
          ))
          .limit(1);
        if (!linkedItem) {
          throw new CommonsRepositoryError("itinerary_not_found", "Linked plan not found.");
        }
      }

      await transaction.insert(moments).values({
        id: command.id,
        commonsId: commonsRecord.id,
        kind: "photo",
        storagePath: command.storagePath,
        mimeType: command.mimeType,
        caption: command.caption,
        altText: command.altText,
        occurredAt: new Date(command.occurredAt),
        dateStatus: command.dateStatus,
        itineraryItemId: command.itineraryItemId,
        eventMatchSource: command.eventMatchSource,
        eventMatchConfidence: command.eventMatchConfidence,
        eventMatchReason: command.eventMatchReason,
        addedByPersonId: actorRow.personId,
        source: "web",
        sourceLabel: `Added by ${actorRow.displayName}`,
      });
      await transaction.insert(processedCommands).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        result: { momentId: command.id },
      });
      await transaction.insert(auditEvents).values({
        commonsId: commonsRecord.id,
        commandId: command.commandId,
        actorId: actorRow.personId,
        actorType: "human",
        action: "moment.added",
        resourceType: "moment",
        resourceId: command.id,
        summary: `${actorRow.displayName} added ${command.caption}.`,
        occurredAt: new Date(command.occurredAt),
      });
    });

    return await readSnapshot(database, slug, options.actorPersonId);
  } finally {
    await database.close();
  }
}

/** Money-only settings; never resubmit stale trip dates, destination or title. */
export async function updateCommonsMoneySettings(slug: string, input: unknown, options: PilotRepositoryOptions) {
  const command = UpdateMoneySettingsCommandSchema.parse(input), database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(tx => runEventCommand(tx, {
      identifier: slug, actorPersonId: options.actorPersonId, commandId: command.commandId, action: "money.settings_updated", input: command,
    }, actor => { if (actor.role !== "organizer") throw new CommonsRepositoryError("actor_not_authorized", "Only organizers can change Money settings."); }, async actor => {
      const [trip] = await tx.select().from(commons).where(eq(commons.id, actor.id));
      if (trip.currency !== command.expectedCurrency || trip.balancesDisabled !== command.expectedBalancesDisabled) throw new CommandConflictError();
      await tx.update(commons).set({ currency: command.currency, balancesDisabled: command.balancesDisabled, updatedAt: actor.now }).where(eq(commons.id, actor.id));
      return { result: { currency: command.currency, balancesDisabled: command.balancesDisabled }, resourceType: "commons", resourceId: actor.id, summary: `${actor.displayName} updated Money settings. New costs default to ${command.currency}; saved amounts retain their currency.` };
    }));
    return await readSnapshot(database, slug, options.actorPersonId);
  } finally { await database.close(); }
}
