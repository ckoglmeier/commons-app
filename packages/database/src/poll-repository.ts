import { projectGoalEventInTransaction, resumeFoodCollectionGoal } from "./coordinator-goal-repository";
import {
    CreatePollRequestSchema,
    PollDetailSchema,
    PollPublicIdSchema,
    PublicPollSchema,
    SubmitPollResponseRequestSchema,
    UpdatePollStatusRequestSchema,
    validatePollAnswers, aggregatePollAnswers, participantRecipeSummary,
    type PollAnswer,
    type PollQuestion,
    type PublicPoll,
} from "@commons/contracts";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { commandFingerprint, runEventCommand } from "./event-command";
import { createDatabase } from "./client";
import { isCommonsId } from "./commons-identifier";
import { auditEvents, commons, invitations, memberships, people, pollDecisions, pollDeliveries, pollDrafts, pollResponses, polls, recipeRuns, recipeOutcomes, stays } from "./schema";
import { publishedPollCommunication, publishedPollCommunicationMode, publishedPollReplacement, resolvePollRecipients } from "./poll-delivery-repository";
import { readPollEvidence } from "./poll-evidence";
import { pollViewerAccess, type PollViewer } from "./poll-access";
import { coordinatorDraftAccess } from "./coordinator-draft-access";
import { assertRecipePublicationContext } from "./recipe-context";
import { assertFoodGoalQuestions } from "./food-goal-guard";
import {
    generateOpaqueToken,
    hashOpaqueToken,
    protectOpaqueToken,
    revealLegacyOrProtectedOpaqueToken,
} from "./tokens";

export type PollRepositoryOptions = {
  databaseUrl?: string;
  actorPersonId: string;
  /** Server rollout setting, never accepted from request JSON. */
  sharedCoordinator?: boolean;
  /** Trusted server-side identity lookup, never accepted from request JSON. */
  resolveVerifiedEmail?: (authUserId: string) => Promise<string | null>;
  /**
   * Whether the Commons-native lodging continuation is enabled for this trip (server configuration). A proposal that carries a preparation intent is still
   * applied when it is off; the outcome then records that preparation was not available. Never accepted from request JSON.
   */
  lodgingContinuationEnabled?: boolean;
  /** Trusted web account rollout gate. Never read from request JSON. */
  activityDecisionsEnabled?: boolean;
  /** Test seam only: called after the preparation outcome is built and before the apply transaction commits; throwing simulates a death there. */
  lodgingCrashPoint?: (point: "prepared_before_commit") => void;
};

export class PollRepositoryError extends Error {
  constructor(
    public readonly code:
      | "poll_not_found"
      | "poll_closed"
      | "actor_not_authorized"
      | "response_not_found"
      | "invalid_response",
      // Authentication errors intentionally disclose no question or event data.
    message: string,
    public readonly savedResponse?: { receiptToken: string; respondentName: string; answers: PollAnswer[]; updatedAt?:string },
  ) {
    super(message);
    this.name = "PollRepositoryError";
  }
}

const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const commonsIdentifier = (identifier: string) => isCommonsId(identifier)
  ? eq(commons.id, identifier)
  : eq(commons.slug, identifier);

export async function localDevelopmentPollViewer(actorPersonId: string, databaseUrl: string): Promise<PollViewer | undefined> {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL || process.env.VERCEL_ENV) return undefined;
  const database = createDatabase(databaseUrl);
  try {
    const [person] = await database.db.select({ authUserId: people.authUserId }).from(people).where(eq(people.id, actorPersonId)).limit(1);
    return person?.authUserId ? { authUserId: person.authUserId, email: null } : undefined;
  } finally { await database.close(); }
}

export function normalizePollAnswers(questions: PollQuestion[], rawAnswers: PollAnswer[]) {
  try { return validatePollAnswers(questions, rawAnswers); }
  catch (cause) { throw new PollRepositoryError("invalid_response", cause instanceof Error ? cause.message : "Check your response."); }
}

function aggregates(questions: PollQuestion[], responses: Array<{ answers: PollAnswer[] }>) {
  return questions.filter(question => !question.organizerOnly && !(question.kind === "text" && question.foodField)).map(question => aggregatePollAnswers(question, responses));
}

export function pollResultsAreVisible(
  ballotMode: "transparent" | "secret",
  status: "open" | "closed" | "revoked",
) {
  return ballotMode === "transparent" || status === "closed";
}

function publicPoll(
  row: {
    id: string;
    publicId: string;
    eventSlug: string;
    eventName: string;
    hasCover: boolean;
    title: string;
    intro: string | null;
    ballotMode: "transparent" | "secret";
    status: "open" | "closed" | "revoked";
    questions: PollQuestion[];
    createdByName: string;
    createdAt: Date;
  },
  responses: Array<{ answers: PollAnswer[] }>,
): PublicPoll {
  const resultsVisible = pollResultsAreVisible(row.ballotMode, row.status) && row.questions.some(q => !q.organizerOnly && !(q.kind === "text" && q.foodField));
  return PublicPollSchema.parse({
    id: row.id,
    publicId: row.publicId,
    event: { slug: row.eventSlug, name: row.eventName, coverImageUrl: row.hasCover ? `/api/v1/polls/${row.publicId}/cover` : null },
    title: row.title,
    intro: row.intro,
    ballotMode: row.ballotMode,
    status: row.status,
    questions: row.questions,
    createdByName: row.createdByName,
    responseCount: responses.length,
    resultsVisible,
    aggregates: resultsVisible ? aggregates(row.questions, responses) : [],
    createdAt: iso(row.createdAt),
  });
}

export async function createCommonsPoll(identifier: string, rawInput: unknown, options: PollRepositoryOptions) {
  const input = CreatePollRequestSchema.parse(rawInput);
  const database = createDatabase(options.databaseUrl);
  try {
    const { pollId } = await database.db.transaction((tx) => runEventCommand(tx, {
      identifier, actorPersonId: options.actorPersonId, commandId: input.commandId,
      action: "poll.created", input,
    }, async (context) => {
      if ((input.communication || input.deliveryApproval || input.shareApproval) && context.role !== "organizer") throw new PollRepositoryError("actor_not_authorized", "Only an organizer can approve a group message.");
      if (!input.draftId) return;
      const [draft] = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.id, input.draftId),
        eq(pollDrafts.commonsId, context.id), coordinatorDraftAccess(options.actorPersonId, context.role))).for("update").limit(1);
      if (!draft || draft.archivedAt || draft.version !== input.draftVersion) throw new PollRepositoryError("invalid_response", "The saved draft changed or was deleted. Reload it and review before sharing.");
      await assertFoodGoalQuestions(tx, context.id, draft.runId, draft.data.questions, context.role);
      // A follow-up relationship does not alter the reviewed questions. Preserve any
      // draft-pinned source; otherwise validate the requested parent below in this transaction.
      const normalized = CreatePollRequestSchema.parse({ ...draft.data, sourcePollId: draft.data.sourcePollId ?? input.sourcePollId, commandId: input.commandId, draftId: input.draftId, draftVersion: input.draftVersion,
        ...(input.publicationApproval ? { audience: undefined, publicationApproval: input.publicationApproval } : input.shareApproval ? { audience: undefined, shareApproval: input.shareApproval } : { deliveryApproval: input.deliveryApproval }) });
      if (commandFingerprint("", "draft", normalized) !== commandFingerprint("", "draft", input)) {
        throw new PollRepositoryError("invalid_response", "Save and review the current questions before sharing.");
      }
    }, async (context) => {
      let threadId: string | null = null;
      if (input.draftId) {
        const [draft] = await tx.select({ publishedPollId: pollDrafts.publishedPollId, threadId: pollDrafts.threadId, runId: pollDrafts.runId, data: pollDrafts.data }).from(pollDrafts).where(eq(pollDrafts.id, input.draftId));
        if (draft.publishedPollId) throw new PollRepositoryError("invalid_response", "This draft already has a share link. Open the saved poll.");
        await assertRecipePublicationContext(tx, context.id, draft.runId, draft.data.recipeContext);
        threadId = draft.threadId;
      }
      const shareToken = generateOpaqueToken();
      if (input.sourcePollId) {
        const [source] = await tx.select().from(polls).where(and(eq(polls.id, input.sourcePollId), eq(polls.commonsId, context.id))).limit(1);
        if (!source || (context.role !== "organizer" && source.createdByPersonId !== options.actorPersonId)) throw new PollRepositoryError("actor_not_authorized", "Only the source poll creator or an organizer can start its follow-up.");
      }
      if (input.audience?.personIds.length) {
        const selected = await tx.select({ id: memberships.personId }).from(memberships).where(and(eq(memberships.commonsId, context.id),
          inArray(memberships.personId, input.audience.personIds), inArray(memberships.status, ["active", "invited"])));
        if (new Set(selected.map(row => row.id)).size !== new Set(input.audience.personIds).size) throw new PollRepositoryError("invalid_response", "A selected recipient is no longer in this event. Review the audience.");
      }
      const publicationAudience = input.publicationApproval && input.publicationApproval.access !== "link" ? { personIds: (await tx.select({ id: memberships.personId }).from(memberships).where(and(eq(memberships.commonsId, context.id), inArray(memberships.status, ["active", "invited"])))).map(row => row.id), guestEmails: [] } : input.audience;
      const [created] = await tx.insert(polls).values({
        commonsId: context.id, threadId, createdByPersonId: options.actorPersonId, commandId: input.commandId,
        title: input.title, intro: input.intro, ballotMode: input.ballotMode, questions: input.questions,
        audience: publicationAudience ?? null,
        sourcePollId: input.sourcePollId ?? null,
        shareTokenHash: hashOpaqueToken(shareToken), shareTokenValue: protectOpaqueToken(shareToken),
      }).returning({ id: polls.id });
      if (input.draftId) await tx.update(pollDrafts).set({ publishedPollId: created.id, updatedAt: context.now }).where(eq(pollDrafts.id, input.draftId));
      if (input.deliveryApproval && input.audience) {
        const selected = await resolvePollRecipients(tx, { commonsId: context.id, audience: input.audience }, options.resolveVerifiedEmail);
        if (!selected.length || input.audience.personIds.some(id => !selected.some(row => row.personId === id)) || input.audience.guestEmails.some(email => !selected.some(row => row.email === email)) || commandFingerprint("", "poll_delivery", { audience: input.audience, selected }) !== input.deliveryApproval.fingerprint) {
          throw new PollRepositoryError("invalid_response", "Recipients changed or an email is missing. Review delivery again.");
        }
        await tx.insert(pollDeliveries).values(selected.map(recipient => ({ pollId: created.id, recipientEmail: recipient.email, personId: recipient.personId })));
      }
      const stayIds = [...new Set(input.questions.flatMap((question) => question.kind === "choice"
        ? question.options.flatMap((option) => option.resource?.type === "stay" ? [option.resource.id] : [])
        : []))];
      if (stayIds.length) {
        const linkedStays = await tx.select({ id: stays.id }).from(stays)
          .where(and(eq(stays.commonsId, context.id), inArray(stays.id, stayIds)));
        if (linkedStays.length !== stayIds.length) {
          throw new PollRepositoryError("invalid_response", "One of those lodging options is no longer available.");
        }
        await tx.update(stays).set({ pollId: created.id, updatedAt: new Date() })
          .where(and(eq(stays.commonsId, context.id), inArray(stays.id, stayIds)));
      }
      return { result: { pollId: created.id }, resourceType: "poll", resourceId: created.id, summary: input.deliveryApproval ? "Approved the saved group message and poll for delivery to the reviewed recipients." : input.audience ? "Created a poll for selected recipients." : `Created poll: ${input.title}.` };
    }));
    return getCommonsPollDetail(identifier, pollId, options);
  } finally {
    await database.close();
  }
}

type PublicPollLookup =
  | { kind: "share_token"; value: string }
  | { kind: "public_id"; value: string };

const publicPollCondition = (lookup: PublicPollLookup) => lookup.kind === "share_token"
  ? eq(polls.shareTokenHash, hashOpaqueToken(lookup.value))
  : eq(polls.publicId, lookup.value);

async function getPublicPoll(lookup: PublicPollLookup, databaseUrl?: string, viewer?: PollViewer) {
  const database = createDatabase(databaseUrl);
  try {
    const [row] = await database.db.select({
      id: polls.id,
      commonsId: polls.commonsId,
      createdByPersonId: polls.createdByPersonId,
      audience: polls.audience,
      publicId: polls.publicId,
      eventSlug: commons.slug,
      eventName: commons.name,
      hasCover: sql<boolean>`${commons.coverOriginalStoragePath} is not null and ${commons.coverMimeType} is not null`,
      title: polls.title,
      intro: polls.intro,
      ballotMode: polls.ballotMode,
      status: polls.status,
      questions: polls.questions,
      createdByName: people.displayName,
      createdAt: polls.createdAt,
      tripNewExperience: commons.newExperience, tripGoingAt: commons.goingAt, tripWelcome: commons.welcomeMessage, tripBrief: commons.bigQuestions,
    }).from(polls)
      .innerJoin(commons, eq(polls.commonsId, commons.id))
      .innerJoin(people, eq(polls.createdByPersonId, people.id))
      .where(publicPollCondition(lookup)).limit(1);
    if (!row || row.status === "revoked") return null;
    const access = await pollViewerAccess(database.db, row, viewer);
    if (!access.allowed) return null;
    const responses = await database.db.select({ answers: pollResponses.answers }).from(pollResponses)
      .where(eq(pollResponses.pollId, row.id));
    const [own] = viewer ? await database.db.select({ respondentName: pollResponses.respondentName, answers: pollResponses.answers, updatedAt: pollResponses.updatedAt }).from(pollResponses)
      .where(and(eq(pollResponses.pollId, row.id), eq(pollResponses.respondentAuthUserId, viewer.authUserId))).limit(1) : [];
    // Only the explicitly reviewed summary is for respondents. Evidence snapshots,
    // private notes, and need resolutions never cross this boundary.
    const [decision] = await database.db.select({ id: pollDecisions.id, summary: pollDecisions.summary,
      approvedByName: pollDecisions.approvedByName, approvedAt: pollDecisions.createdAt,
      target: pollDecisions.target, planId: pollDecisions.planId, recipeOutcomeId: recipeOutcomes.id, recipeResult: recipeOutcomes.result }).from(pollDecisions)
      .leftJoin(recipeOutcomes, eq(recipeOutcomes.decisionId, pollDecisions.id)).where(eq(pollDecisions.pollId, row.id));
    // Exclude the private result object itself, not just its exception text.
    const participantDecision = decision ? { id: decision.id,
      summary: decision.recipeOutcomeId ? participantRecipeSummary(decision.recipeResult) : decision.summary,
      approvedByName: decision.approvedByName, approvedAt: iso(decision.approvedAt), target: decision.target, planId: decision.planId } : null;
    const tripBrief = row.tripNewExperience && !row.tripGoingAt ? { welcome: row.tripWelcome, organizerName: row.createdByName, decideBy: row.tripBrief?.decideBy ?? null, roughCost: row.tripBrief?.roughCost ?? null } : null;
    return { ...publicPoll(row, responses), tripBrief, identityBound: Boolean(viewer), authenticatedName: viewer ? access.respondentName ?? null : null,
      superseded: await publishedPollReplacement(database.db, row.id),
      communication: await publishedPollCommunication(database.db, row.id),
      communicationMode: await publishedPollCommunicationMode(database.db, row.id),
      decision: participantDecision,
      ownResponse: own ? { ...own, updatedAt: iso(own.updatedAt) } : null };
  } finally {
    await database.close();
  }
}

export async function getPublicPollByToken(shareToken: string, databaseUrl?: string, viewer?: PollViewer) {
  return getPublicPoll({ kind: "share_token", value: shareToken }, databaseUrl, viewer);
}

export async function getPublicPollByPublicId(publicId: string, databaseUrl?: string, viewer?: PollViewer) {
  const normalized = PollPublicIdSchema.safeParse(publicId.toLowerCase());
  return normalized.success ? getPublicPoll({ kind: "public_id", value: normalized.data }, databaseUrl, viewer) : null;
}

export async function getPendingPollInvitation(publicId: string, viewer: PollViewer, databaseUrl?: string) {
  if (!viewer.email || !PollPublicIdSchema.safeParse(publicId).success) return null;
  const database = createDatabase(databaseUrl);
  try {
    const [poll] = await database.db.select().from(polls).where(eq(polls.publicId, publicId)).limit(1);
    if (!poll?.audience?.personIds.length || poll.status === "revoked") return null;
    const rows = await database.db.select({ token: invitations.tokenValue, email: invitations.recipientEmail, expiresAt: invitations.expiresAt, authUserId: people.authUserId }).from(invitations)
      .innerJoin(memberships, and(eq(memberships.commonsId, invitations.commonsId), eq(memberships.personId, invitations.provisionalPersonId)))
      .innerJoin(people, eq(people.id, invitations.provisionalPersonId))
      .where(and(eq(invitations.commonsId, poll.commonsId), eq(invitations.status, "pending"), eq(memberships.status, "invited"), inArray(invitations.provisionalPersonId, poll.audience.personIds)));
    const invitation = rows.find(row => row.email?.trim().toLowerCase() === viewer.email?.trim().toLowerCase()
      && (!row.authUserId || row.authUserId === viewer.authUserId) && (!row.expiresAt || row.expiresAt > new Date()));
    return invitation?.token ? revealLegacyOrProtectedOpaqueToken(invitation.token) : null;
  } finally { await database.close(); }
}

async function submitPollResponse(
  lookup: PublicPollLookup,
  rawInput: unknown,
  databaseUrl?: string,
  viewer?: PollViewer,
) {
  const input = SubmitPollResponseRequestSchema.parse(rawInput);
  const database = createDatabase(databaseUrl);
  try {
    const result = await database.db.transaction(async (transaction) => {
      const reply = await (async()=>{
      const [location] = await transaction.select({ eventId: polls.commonsId }).from(polls).where(publicPollCondition(lookup)).limit(1);
      if (location) await transaction.select({ id: commons.id }).from(commons).where(eq(commons.id, location.eventId)).for("update");
      const [poll] = await transaction.select({ id: polls.id, commonsId: polls.commonsId, createdByPersonId: polls.createdByPersonId, audience: polls.audience, status: polls.status, questions: polls.questions, ballotMode: polls.ballotMode })
        .from(polls).where(publicPollCondition(lookup)).for("update").limit(1);
      if (!poll || poll.status === "revoked") throw new PollRepositoryError("poll_not_found", "That poll link is no longer available.");
      const access = await pollViewerAccess(transaction, poll, viewer);
      if (!access.allowed) throw new PollRepositoryError("poll_not_found", "Sign in with the invited account to open this poll. If you declined the event, ask for a new invitation.");
      if (!viewer && !input.respondentName) throw new PollRepositoryError("invalid_response", "Add your name before responding.");
      if (poll.status !== "open") throw new PollRepositoryError("poll_closed", "Voting is closed for this poll.");
      if (poll.ballotMode === "secret" && input.answers.some(answer => answer.context)) {
        throw new PollRepositoryError("invalid_response", "Private context is unavailable for secret ballots.");
      }
      const answers = normalizePollAnswers(poll.questions, input.answers);
      if (viewer) {
        const respondentName = access.respondentName ?? "Signed-in participant";
        const receiptToken = input.receiptToken ?? input.newReceiptToken ?? generateOpaqueToken();
        const [existing] = await transaction.select().from(pollResponses)
          .where(and(eq(pollResponses.pollId, poll.id), eq(pollResponses.respondentAuthUserId, viewer.authUserId))).limit(1);
        // Account binding, not a copied browser receipt, authorizes revisions.
        if (existing) {
          const same = commandFingerprint("", "ballot", { name: existing.respondentName, answers: existing.answers }) === commandFingerprint("", "ballot", { name: respondentName, answers });
          if (same) return { receiptToken, revised: true };
          if (input.expectedResponseUpdatedAt !== iso(existing.updatedAt)) throw new PollRepositoryError("invalid_response", "Your response changed on another device. Reload this poll and review the saved answer before revising it.");
          await transaction.update(pollResponses).set({ respondentName: respondentName, answers, updatedAt: new Date() }).where(eq(pollResponses.id, existing.id));
        }
        else await transaction.insert(pollResponses).values({ pollId: poll.id, respondentAuthUserId: viewer.authUserId,
          respondentPersonId: access.personId, respondentName: respondentName, answers,
          receiptTokenHash: hashOpaqueToken(generateOpaqueToken()) });
        return { receiptToken, revised: Boolean(existing) };
      }
      if (input.receiptToken) {
        const [existing] = await transaction.select().from(pollResponses)
          .where(and(eq(pollResponses.pollId, poll.id), eq(pollResponses.receiptTokenHash, hashOpaqueToken(input.receiptToken)))).limit(1);
        if (!existing) throw new PollRepositoryError("response_not_found", "This response could not be revised. Open the original link on the device you used to vote.");
        const same=commandFingerprint("", "ballot", {name:existing.respondentName,answers:existing.answers})===commandFingerprint("", "ballot", {name:input.respondentName,answers});
        if(same) return {receiptToken:input.receiptToken,revised:true,responseUpdatedAt:iso(existing.updatedAt)};
        if(poll.questions.some(question=>question.kind==="choice" && question.itinerary) && input.expectedResponseUpdatedAt!==iso(existing.updatedAt)) throw new PollRepositoryError("invalid_response","Your response changed in another tab. Review the saved feedback before updating it.",{receiptToken:input.receiptToken,respondentName:existing.respondentName,answers:existing.answers,updatedAt:iso(existing.updatedAt)});
        const updatedAt=new Date();
        await transaction.update(pollResponses).set({
          respondentName: input.respondentName,
          answers,
          updatedAt,
        }).where(eq(pollResponses.id, existing.id));
        return { receiptToken: input.receiptToken, revised: true,responseUpdatedAt:updatedAt.toISOString() };
      }
      const receiptToken = input.newReceiptToken ?? generateOpaqueToken();
      if (input.newReceiptToken) {
        const [existing] = await transaction.select().from(pollResponses)
          .where(and(eq(pollResponses.pollId, poll.id), eq(pollResponses.receiptTokenHash, hashOpaqueToken(receiptToken)))).limit(1);
        if (existing) {
          if (commandFingerprint("", "ballot", { name: existing.respondentName, answers: existing.answers }) !==
              commandFingerprint("", "ballot", { name: input.respondentName, answers })) {
            throw new PollRepositoryError("invalid_response", "Your earlier response was saved. Review your choices before updating it.",
              { receiptToken, respondentName: existing.respondentName, answers: existing.answers,updatedAt:iso(existing.updatedAt) });
          }
          return { receiptToken, revised: false,responseUpdatedAt:iso(existing.updatedAt) };
        }
      }
      const updatedAt=new Date();
      await transaction.insert(pollResponses).values({
        pollId: poll.id,
        respondentName: input.respondentName,
        receiptTokenHash: hashOpaqueToken(receiptToken),
        answers,
        updatedAt,
      });
      return { receiptToken, revised: false, responseUpdatedAt: updatedAt.toISOString() };
      })();
      const [currentPoll] = await transaction.select().from(polls).where(publicPollCondition(lookup)).limit(1);
      if(currentPoll)await projectGoalEventInTransaction(transaction,currentPoll.commonsId,currentPoll.id);
      // Server-only outcome telemetry identity; the response route strips these before replying.
      return { ...reply, telemetryTripId: currentPoll?.commonsId ?? null, telemetryPollId: currentPoll?.id ?? null };
    });
    return { ...result, poll: await getPublicPoll(lookup, databaseUrl, viewer) };
  } finally {
    await database.close();
  }
}

export async function submitPublicPollResponse(shareToken: string, rawInput: unknown, databaseUrl?: string, viewer?: PollViewer) {
  return submitPollResponse({ kind: "share_token", value: shareToken }, rawInput, databaseUrl, viewer);
}

export async function submitPublicPollResponseByPublicId(publicId: string, rawInput: unknown, databaseUrl?: string, viewer?: PollViewer) {
  const normalized = PollPublicIdSchema.safeParse(publicId.toLowerCase());
  if (!normalized.success) throw new PollRepositoryError("poll_not_found", "That poll link is no longer available.");
  return submitPollResponse({ kind: "public_id", value: normalized.data }, rawInput, databaseUrl, viewer);
}

export async function getCommonsPollDetail(identifier: string, pollId: string, options: PollRepositoryOptions) {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
    const [row] = await tx.select({
      id: polls.id,
      audience: polls.audience,
      publicId: polls.publicId,
      eventSlug: commons.slug,
      eventName: commons.name,
      hasCover: sql<boolean>`${commons.coverOriginalStoragePath} is not null and ${commons.coverMimeType} is not null`,
      title: polls.title,
      intro: polls.intro,
      ballotMode: polls.ballotMode,
      status: polls.status,
      questions: polls.questions,
      shareTokenValue: polls.shareTokenValue,
      createdByPersonId: polls.createdByPersonId,
      createdByName: people.displayName,
      createdAt: polls.createdAt,
      currentActorRole: memberships.role,
      currentActorStatus: memberships.status,
    }).from(polls)
      .innerJoin(commons, eq(polls.commonsId, commons.id))
      .innerJoin(people, eq(polls.createdByPersonId, people.id))
      .innerJoin(memberships, and(eq(memberships.commonsId, commons.id), eq(memberships.personId, options.actorPersonId)))
      .where(and(commonsIdentifier(identifier), eq(polls.id, pollId))).limit(1);
    if (!row || row.currentActorStatus !== "active") {
      throw new PollRepositoryError("poll_not_found", "That poll is not available in this trip.");
    }
    if (row.audience && row.currentActorRole !== "organizer" && row.createdByPersonId !== options.actorPersonId
      && !row.audience.personIds.includes(options.actorPersonId)) throw new PollRepositoryError("poll_not_found", "This poll is not in your audience.");
    const responses = await tx.select({
      id: pollResponses.id,
      respondentName: pollResponses.respondentName,
      answers: pollResponses.answers,
      updatedAt: pollResponses.updatedAt,
    }).from(pollResponses).where(eq(pollResponses.pollId, row.id)).orderBy(asc(pollResponses.submittedAt));
    const publicResult = publicPoll(row, responses);
    const canManage = row.currentActorRole === "organizer" || row.createdByPersonId === options.actorPersonId;
    const [fullPoll] = canManage ? await tx.select().from(polls).where(eq(polls.id, pollId)) : [];
    const evidenceFingerprint = fullPoll ? (await readPollEvidence(tx, fullPoll)).fingerprint : undefined;
    const [decision] = await tx.select({ id: pollDecisions.id, summary: pollDecisions.summary, approvedByName: pollDecisions.approvedByName,
      approvedAt: pollDecisions.createdAt, target: pollDecisions.target, planId: pollDecisions.planId, approval: pollDecisions.approval, recipeOutcomeId: recipeOutcomes.id, recipeResult: recipeOutcomes.result }).from(pollDecisions)
      .leftJoin(recipeOutcomes, eq(recipeOutcomes.decisionId, pollDecisions.id)).where(eq(pollDecisions.pollId, pollId));
    // The approved choices that are trip stays, so organizers can make one the stay.
    const selectedStayIds = canManage && decision ? [...new Set((decision.approval?.selected ?? []).flatMap(choice => {
      const question = publicResult.questions.find(item => item.id === choice.questionId);
      const option = question?.kind === "choice" ? question.options.find(item => item.id === choice.optionId) : undefined;
      return option?.resource?.type === "stay" ? [option.resource.id] : [];
    }))] : undefined;
    const visibleDecision = decision ? { id: decision.id,
      summary: !canManage && decision.recipeOutcomeId ? participantRecipeSummary(decision.recipeResult) : decision.summary,
      approvedByName: decision.approvedByName, approvedAt: iso(decision.approvedAt), target: decision.target, planId: decision.planId,
      ...(selectedStayIds?.length ? { selectedStayIds } : {}) } : null;
    return PollDetailSchema.parse({
      ...publicResult,
      superseded: await publishedPollReplacement(tx, row.id),
      communication: await publishedPollCommunication(tx, row.id),
      communicationMode: await publishedPollCommunicationMode(tx, row.id),
      evidenceFingerprint,
      decision: visibleDecision,
      identityBound: Boolean(row.audience),
      audienceReview: row.audience && (row.currentActorRole === "organizer" || row.createdByPersonId === options.actorPersonId)
        ? { ...row.audience, fingerprint: commandFingerprint("", "audience", row.audience) } : null,
      shareToken: revealLegacyOrProtectedOpaqueToken(row.shareTokenValue),
      currentActorRole: row.currentActorRole,
      currentActorCanManage: row.currentActorRole === "organizer" || row.createdByPersonId === options.actorPersonId,
      responses: responses.map((response) => ({
        ...response,
        answers: pollAnswersForViewer(response.answers, row.ballotMode,
          row.currentActorRole === "organizer" || row.createdByPersonId === options.actorPersonId, row.questions),
        updatedAt: iso(response.updatedAt),
      })),
    });
    }, { isolationLevel: "repeatable read" });
  } finally {
    await database.close();
  }
}

/** Private context never crosses the member boundary, even after voting closes.
 * Secret ballots never expose attributed answers or context to any viewer. */
export function pollAnswersForViewer(answers: PollAnswer[], mode: "transparent" | "secret", canManage: boolean, questions: PollQuestion[] = []): PollAnswer[] | null {
  if (mode === "secret") return null;
  return answers.filter(answer => canManage || !questions.some(q => q.id === answer.questionId && (q.organizerOnly || (q.kind === "text" && q.foodField)))).map(({ context, itineraryFeedback, ...answer }) => canManage ? { ...answer, ...(context ? { context } : {}), ...(itineraryFeedback ? { itineraryFeedback } : {}) } : answer);
}

export async function revokePollRecipient(identifier: string, pollId: string, rawInput: unknown, options: PollRepositoryOptions) {
  const input = z.object({ commandId: z.string().uuid(), fingerprint: z.string().length(64), kind: z.enum(["person", "email"]), recipient: z.string().max(320) }).parse(rawInput);
  const database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(tx => runEventCommand(tx, { identifier, actorPersonId: options.actorPersonId, commandId: input.commandId, action: "poll.recipient_revoked", input: { pollId, ...input } },
      async context => {
        const [poll] = await tx.select().from(polls).where(and(eq(polls.commonsId, context.id), eq(polls.id, pollId))).limit(1);
        if (!poll || (context.role !== "organizer" && poll.createdByPersonId !== options.actorPersonId)) throw new PollRepositoryError("actor_not_authorized", "Only the poll creator or an organizer can change the audience.");
      }, async context => {
        const [poll] = await tx.select().from(polls).where(eq(polls.id, pollId)).for("update").limit(1);
        if (!poll.audience || commandFingerprint("", "audience", poll.audience) !== input.fingerprint) throw new PollRepositoryError("invalid_response", "The audience changed. Reload and review it before removing access.");
        const audience = { personIds: poll.audience.personIds.filter(id => input.kind !== "person" || id !== input.recipient), guestEmails: poll.audience.guestEmails.filter(email => input.kind !== "email" || email !== input.recipient) };
        await tx.update(polls).set({ audience, updatedAt: context.now, ...(!audience.personIds.length && !audience.guestEmails.length ? { status: "revoked" as const } : {}) }).where(eq(polls.id, pollId));
        await projectGoalEventInTransaction(tx, context.id, pollId, context.now);
        return { result: { pollId }, resourceType: "poll", resourceId: pollId, summary: "Removed a recipient’s poll access. Historical responses were preserved." };
      }));
    return getCommonsPollDetail(identifier, pollId, options);
  } finally { await database.close(); }
}

export async function deleteCommonsPollResponse(
  identifier: string,
  pollId: string,
  responseId: string,
  options: PollRepositoryOptions,
) {
  const database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(async (transaction) => {
      const [location] = await transaction.select({ eventId: polls.commonsId }).from(polls).where(eq(polls.id, pollId)).limit(1);
      if (location) await transaction.select({ id: commons.id }).from(commons).where(eq(commons.id, location.eventId)).for("update");
      const [context] = await transaction.select({
        commonsId: commons.id,
        role: memberships.role,
        membershipStatus: memberships.status,
        createdByPersonId: polls.createdByPersonId,
        respondentName: pollResponses.respondentName,
      }).from(pollResponses)
        .innerJoin(polls, eq(pollResponses.pollId, polls.id))
        .innerJoin(commons, eq(polls.commonsId, commons.id))
        .innerJoin(memberships, and(eq(memberships.commonsId, commons.id), eq(memberships.personId, options.actorPersonId)))
        .where(and(commonsIdentifier(identifier), eq(polls.id, pollId), eq(pollResponses.id, responseId))).limit(1);
      if (!context || context.membershipStatus !== "active") {
        throw new PollRepositoryError("response_not_found", "That poll response is not available in this trip.");
      }
      if (context.role !== "organizer" && context.createdByPersonId !== options.actorPersonId) {
        throw new PollRepositoryError("actor_not_authorized", "Only the poll creator or an organizer can delete responses.");
      }
      await transaction.delete(pollResponses).where(and(eq(pollResponses.id, responseId), eq(pollResponses.pollId, pollId)));
      await transaction.update(polls).set({updatedAt:new Date()}).where(eq(polls.id,pollId));
      await projectGoalEventInTransaction(transaction,context.commonsId,pollId);
      await transaction.insert(auditEvents).values({
        commonsId: context.commonsId,
        commandId: `poll-response-delete:${responseId}`,
        actorId: options.actorPersonId,
        actorType: "human",
        action: "poll.response_deleted",
        resourceType: "poll_response",
        resourceId: responseId,
        summary: `Deleted poll response from ${context.respondentName}.`,
      });
    });
    return getCommonsPollDetail(identifier, pollId, options);
  } finally {
    await database.close();
  }
}

export async function updateCommonsPollStatus(
  identifier: string,
  pollId: string,
  rawInput: unknown,
  options: PollRepositoryOptions,
) {
  const input = UpdatePollStatusRequestSchema.parse(rawInput);
  const database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction((tx) => runEventCommand(tx, {
      identifier, actorPersonId: options.actorPersonId, commandId: input.commandId,
      action: "poll.status_updated", input: { pollId, ...input },
    }, async (context) => {
      const [poll] = await tx.select({ createdBy: polls.createdByPersonId }).from(polls)
        .where(and(eq(polls.commonsId, context.id), eq(polls.id, pollId))).limit(1);
      if (!poll || (context.role !== "organizer" && poll.createdBy !== options.actorPersonId)) {
        throw new PollRepositoryError("actor_not_authorized", "Only the poll creator or an organizer can change voting.");
      }
      const [recipeDraft] = await tx.select({ runId: pollDrafts.runId }).from(pollDrafts)
        .where(and(eq(pollDrafts.commonsId, context.id), eq(pollDrafts.publishedPollId, pollId))).limit(1);
      if (recipeDraft?.runId && context.role !== "organizer") {
        throw new PollRepositoryError("actor_not_authorized", "Only an active organizer can change voting on a recipe poll.");
      }
    }, async (context) => {
      const [decision] = await tx.select({ id: pollDecisions.id }).from(pollDecisions).where(eq(pollDecisions.pollId, pollId));
      const [artifact] = await tx.select({ data: pollDrafts.data, runId: pollDrafts.runId }).from(pollDrafts).where(and(eq(pollDrafts.commonsId, context.id), eq(pollDrafts.publishedPollId, pollId)));
      if (artifact?.data.lifecycle?.replacementDraftId && input.status === "open") throw new PollRepositoryError("invalid_response", "This version was superseded. Publish its replacement draft instead.");
      if (decision && input.status === "open") throw new PollRepositoryError("invalid_response", "This poll has an approved decision. Start a follow-up round instead of reopening its evidence.");
      await tx.update(polls).set({ status: input.status,
        closedAt: input.status === "closed" ? context.now : null, updatedAt: context.now,
      }).where(eq(polls.id, pollId));
      await projectGoalEventInTransaction(tx,context.id,pollId,context.now);
      if (artifact?.runId) {
        const [run] = await tx.select().from(recipeRuns).where(and(eq(recipeRuns.id, artifact.runId), eq(recipeRuns.commonsId, context.id)));
        if (run?.recipe === "food_preferences" && run.status === "active") {
          if (input.status === "open") await resumeFoodCollectionGoal(tx, context.id, run.id, context.now);
          await projectGoalEventInTransaction(tx, context.id, run.id, context.now);
        }
      }
      return { result: { pollId, status: input.status }, resourceType: "poll", resourceId: pollId,
        summary: input.status === "closed" ? "Closed poll voting." : "Reopened poll voting." };
    }));
    return getCommonsPollDetail(identifier, pollId, options);
  } finally {
    await database.close();
  }
}
