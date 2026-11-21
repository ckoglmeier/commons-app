import { eventAttendanceDates } from "@commons/contracts";
import {
  AttendanceReviewError, closeQuestion, CommandAccessError, CommandConflictError, enrolledTripsForNumber, getMessage, isWebAddress, getPublicPollByPublicId, lastOutboundQuestionId, markInbound, openQuestion,
  optOutPhone, personAuth, phoneNumberFor, PollRepositoryError, reenrollPhone, setEventAttendance, shownOpenQuestionsForPerson, submitPublicPollResponseByPublicId, touchPhone, type EnrolledTrip, type QuestionRow,
} from "@commons/database";
import {
  answerPlanQuestion as answerFromSavedPlan, classifyKeyword, looksLikeBooking, normalizeReply, parseApproval, parseAttendanceReply, parseMultiOptionReply, parseOptionReply, parseYesNo, routeInbound, SMS_CONSENT_WORDING, tripLabel, WEB_MESSAGES_CONSENT_WORDING, type RouteDecision, type RoutableQuestion,
} from "@commons/domain";
import { publicPollPath } from "@/lib/poll-route";
import { answerBookingInfo, answerBookingReview, handleBookingMessage, replyForOutcome } from "./booking";
import { copyFor, dbOptions, queue, snapshotOf, tripUrl, type Conversation, type MessagingDeps, type Person } from "./core";
import { deterministicUuid } from "./extraction";
import { answerMoneyInfo, answerMoneyReview, handleMoneyMessage } from "./money";
import { askQuestion, planNextQuestion, questionState, simplePollQuestion, ymd } from "./planner";

const toRoutable = (question: QuestionRow): RoutableQuestion => ({ id: question.id, commonsId: question.commonsId, kind: question.kind as RoutableQuestion["kind"], version: question.version, options: question.options, expiresAt: question.expiresAt, askedAt: question.createdAt, approvalCode: question.approvalCode, heldMessageId: question.heldMessageId });
const tripOf = (c: Conversation, id: string) => c.trips.find(trip => trip.id === id)!;
const reply = (c: Conversation, trip: EnrolledTrip | null, suffix: string, body: string, questionId?: string | null) =>
  queue(c, { key: `reply:${c.message.id}:${suffix}`, purpose: `reply:${suffix}`, body, tripId: trip?.id ?? null, questionId });

/**
 * Process one stored inbound message. Order matters: carrier keywords first, then who the sender is, then which authorized trip, then which pending
 * question (at which version). Nothing is read as an instruction from the message itself, and anything uncertain becomes a question, not an action.
 */
export async function processInbound(deps: MessagingDeps, messageId: string) {
  const message = await getMessage(messageId, dbOptions(deps));
  if (!message || message.direction !== "inbound" || message.status !== "received") return;
  const e164 = await phoneNumberFor(message.phoneHash, dbOptions(deps));
  if (!e164) { await markInbound(message.id, "ignored", "no_number", {}, dbOptions(deps)); return; }
  const anonymous = { deps, e164, person: null };
  const keyword = classifyKeyword(message.body);
  // A carrier may answer STOP/START itself on a phone; nothing does that for a thread in Commons, so Commons always answers there.
  const answerKeywords = isWebAddress(e164) || !deps.provider.handlesOptOutReplies;
  if (keyword === "stop") {
    await optOutPhone(e164, dbOptions(deps));
    if (answerKeywords) await queue(anonymous, { key: `compliance:${message.id}`, purpose: "compliance:stop", body: copyFor(e164).stopped });
    await markInbound(message.id, "processed", "stop", {}, dbOptions(deps));
    return;
  }
  if (keyword === "start") {
    // The restored consent records where it was given: a START in a thread in Commons is the web wording, not the carrier's.
    const restored = await reenrollPhone(e164, isWebAddress(e164) ? WEB_MESSAGES_CONSENT_WORDING : SMS_CONSENT_WORDING, dbOptions(deps));
    if (answerKeywords) await queue(anonymous, { key: `compliance:${message.id}`, purpose: "compliance:start", body: copyFor(e164).startBack(restored.length, deps.origin) });
    await markInbound(message.id, "processed", `start:${restored.length}`, {}, dbOptions(deps));
    return;
  }
  const state = await enrolledTripsForNumber(e164, dbOptions(deps));
  if (keyword === "help") {
    if (!state.optedOut) await queue(anonymous, { key: `compliance:${message.id}`, purpose: "compliance:help", body: copyFor(e164).help(deps.supportEmail) });
    await markInbound(message.id, "processed", "help", {}, dbOptions(deps));
    return;
  }
  if (state.optedOut) { await markInbound(message.id, "ignored", "opted_out", {}, dbOptions(deps)); return; }
  const handoff = async (body: string, detail: string) => {
    // One handoff a day per number. A sender Commons cannot match learns how to sign in and nothing about any trip.
    const phone = await touchPhone(e164, {}, dbOptions(deps));
    if (!phone.handoffSentAt || deps.now().getTime() - phone.handoffSentAt.getTime() > 86_400_000) {
      await queue(anonymous, { key: `handoff:${message.phoneHash}:${ymd(deps.now(), "UTC")}`, purpose: "reply:handoff", body });
      await touchPhone(e164, { handoffSent: true }, dbOptions(deps));
    }
    await markInbound(message.id, "ignored", detail, {}, dbOptions(deps));
  };
  if (!state.personId) return handoff(copyFor(e164).unknownSender(`${deps.origin}/sign-in`), "unknown_sender");
  if (!state.trips.length) return handoff(copyFor(e164).notEnrolled(deps.origin), "not_enrolled");
  const trips = state.trips;

  const person: Person = { id: state.personId, name: state.displayName ?? "there" };
  const c: Conversation = { deps, e164, phoneHash: message.phoneHash, person, trips, message };
  await markInbound(message.id, "processed", null, { personId: person.id }, dbOptions(deps));
  // A reply answers only a question the person has seen. One that is queued, held for quiet hours or pacing, stays queued and unanswered until it goes out.
  const open = await shownOpenQuestionsForPerson(person.id, dbOptions(deps));
  const decision = routeInbound({ now: deps.now(), body: message.body, trips, open: open.map(toRoutable), lastOutboundQuestionId: await lastOutboundQuestionId(message.phoneHash, dbOptions(deps)) });
  await execute(c, decision, open);
}

async function execute(c: Conversation, decision: RouteDecision, open: QuestionRow[]) {
  const { deps } = c;
  switch (decision.kind) {
    case "no_trips": return;
    case "clarify_trip": {
      if (decision.reask) { await reply(c, null, "reask", copyFor(c.e164).tripChoiceReask(decision.trips)); return; }
      const options = decision.trips.map((trip, index) => ({ key: String(index + 1), label: tripLabel(trip), value: trip.id }));
      const question = await openQuestion({ personId: c.person.id, commonsId: decision.trips[0]!.id, kind: "trip_choice", refId: "choice", version: "1", options, heldMessageId: c.message.id, expiresAt: new Date(deps.now().getTime() + 2 * 3_600_000) }, dbOptions(deps));
      await reply(c, null, "choose", copyFor(c.e164).tripChoice(decision.trips), question.id);
      // The request waits, unread as an action. Only a message that names a trip releases it.
      await markInbound(c.message.id, "held", "awaiting_trip_choice", {}, dbOptions(deps));
      return;
    }
    case "trip_choice_answer": {
      const trip = tripOf(c, decision.tripId);
      await closeQuestion(decision.question.id, "answered", decision.tripId, dbOptions(deps));
      const held = decision.question.heldMessageId && decision.question.heldMessageId !== c.message.id ? await getMessage(decision.question.heldMessageId, dbOptions(deps)) : null;
      if (!held) { await reply(c, trip, "chosen", `Okay, ${trip.name}. What would you like to do?`); return; }
      await markInbound(held.id, "processed", "released_after_trip_choice", { commonsId: trip.id }, dbOptions(deps));
      await inTrip({ ...c, message: held }, trip);
      return;
    }
    case "stale": {
      const trip = tripOf(c, decision.tripId);
      await closeQuestion(decision.question.id, "expired", null, dbOptions(deps));
      await reply(c, trip, "stale", copyFor(c.e164).staleReply(trip.name));
      await askNext(c, trip);
      return;
    }
    case "approval_mismatch": {
      const trip = tripOf(c, decision.tripId);
      await reply(c, trip, "stale_code", copyFor(c.e164).reviewStaleCode(trip.name, decision.question.approvalCode ?? ""));
      return;
    }
    case "review_ambiguous": {
      const trip = tripOf(c, decision.tripId);
      await reply(c, trip, "review_ambiguous", `${trip.name}: I'm waiting on your answer about the summary I sent. To save it, reply SAVE ${decision.question.approvalCode}. Reply DISCARD to drop it. I haven't changed anything.`);
      return;
    }
    case "no_open_question": return freeText(c, tripOf(c, decision.tripId), open);
    case "answer": return answer(c, tripOf(c, decision.question.commonsId), open.find(question => question.id === decision.question.id)!, open);
  }
}

/** The person (or a released held message) is now bound to one trip; route again among only that trip's questions. */
async function inTrip(c: Conversation, trip: EnrolledTrip) {
  const open = (await shownOpenQuestionsForPerson(c.person.id, dbOptions(c.deps))).filter(question => question.commonsId === trip.id && question.kind !== "trip_choice");
  const decision = routeInbound({ now: c.deps.now(), body: c.message.body, trips: [trip], open: open.map(toRoutable), lastOutboundQuestionId: null });
  await execute({ ...c, trips: [trip] }, decision, open);
}

async function askNext(c: Conversation, trip: EnrolledTrip) {
  const planned = await planNextQuestion(c.deps, c.person, trip);
  if (planned) await askQuestion(c.deps, c.person, trip, planned, { purpose: "reply:next" });
}

async function answer(c: Conversation, trip: EnrolledTrip, question: QuestionRow, open: QuestionRow[]) {
  const { deps } = c;
  if (["attendance", "attendance_decline", "poll", "arrival"].includes(question.kind)) {
    const state = await questionState(deps, question, c.person);
    // Settled on the web or by another text. This message isn't an answer to it, but it may still be a booking or a question about the plan.
    if (state === "resolved") { await closeQuestion(question.id, "resolved_elsewhere", null, dbOptions(deps)); return freeText(c, trip, open.filter(item => item.id !== question.id)); }
    if (state === "changed") {
      // What the question was about moved after it was asked. The reply is not applied; the person gets the current question.
      await closeQuestion(question.id, "superseded", null, dbOptions(deps));
      await reply(c, trip, "changed", question.kind === "poll" ? copyFor(c.e164).pollChanged(trip.name) : copyFor(c.e164).versionChanged(trip.name));
      await askNext(c, trip);
      return;
    }
  }
  // While a question is open the person may still send a booking or ask about the saved plan; the question stays open and unanswered.
  const aside = async () => {
    if ((c.message.media.length > 0 || looksLikeBooking(c.message.body)) && await handleBookingMessage(c, trip)) return true;
    if (await handleMoneyMessage(c, trip)) return true;
    const answered = await answerPlanQuestion(c, trip);
    if (answered === null) return false;
    await reply(c, trip, "plan", answered);
    return true;
  };
  switch (question.kind) {
    case "attendance": return answerAttendance(c, trip, question, aside);
    case "attendance_decline": return answerDecline(c, trip, question);
    case "poll": return answerPoll(c, trip, question, aside);
    case "arrival": {
      const text = normalizeReply(c.message.body);
      if (text === "driving") { await closeQuestion(question.id, "answered", "driving", dbOptions(deps)); await reply(c, trip, "arrival", copyFor(c.e164).arrivalDriving(trip.name)); return; }
      if (text === "later") { await closeQuestion(question.id, "answered", "later", dbOptions(deps)); await reply(c, trip, "arrival", copyFor(c.e164).arrivalLater(trip.name)); return; }
      if (await handleBookingMessage(c, trip)) { await closeQuestion(question.id, "answered", "details_sent", dbOptions(deps)); return; }
      if (await aside()) return;
      await reply(c, trip, "arrival_again", copyFor(c.e164).arrival(trip.name));
      return;
    }
    case "booking_review": {
      if (c.message.media.length || (looksLikeBooking(c.message.body) && !/^\s*save\b/i.test(c.message.body))) { await handleBookingMessage(c, trip); return; }
      return answerBookingReview(c, trip, question);
    }
    case "booking_info": {
      if (c.message.media.length || looksLikeBooking(c.message.body)) { await handleBookingMessage(c, trip); return; }
      const outcome = await answerBookingInfo(c, trip, question);
      if (!outcome) { await reply(c, trip, "info_stale", copyFor(c.e164).versionChanged(trip.name)); await closeQuestion(question.id, "superseded", null, dbOptions(deps)); return; }
      if (outcome.kind === "unparsed") { await reply(c, trip, "info_again", `${trip.name}: ${outcome.question}`); return; }
      await replyForOutcome(c, trip, outcome);
      return;
    }
    case "money_review": return answerMoneyReview(c, trip, question);
    case "money_info": {
      // A booking, a new report or a question about the plan isn't the answer to "how much was it?". The question stays open.
      if (parseApproval(c.message.body).action === "none" && await aside()) return;
      return answerMoneyInfo(c, trip, question);
    }
    default: return freeText(c, trip, open);
  }
}

async function answerAttendance(c: Conversation, trip: EnrolledTrip, question: QuestionRow, aside: () => Promise<boolean>) {
  const { deps } = c, parsed = parseAttendanceReply(c.message.body);
  if (parsed === "unclear") { if (await aside()) return; await reply(c, trip, "attendance_unclear", copyFor(c.e164).attendanceUnclear(trip.name)); return; }
  if (parsed === "declined") {
    // Declining closes the person's invitation, so it is confirmed once before anything changes.
    await closeQuestion(question.id, "answered", "declined_pending", dbOptions(deps));
    const confirm = await openQuestion({ personId: c.person.id, commonsId: trip.id, kind: "attendance_decline", refId: "decline", version: question.version, expiresAt: new Date(deps.now().getTime() + 2 * 3_600_000) }, dbOptions(deps));
    await reply(c, trip, "decline_confirm", copyFor(c.e164).attendanceDeclineConfirm(trip.name), confirm.id);
    return;
  }
  const saved = await saveAttendance(c, trip, parsed === "attending" ? "attending" : "helping");
  if (!saved) return;
  await closeQuestion(question.id, "answered", parsed, dbOptions(deps));
  await reply(c, trip, "attendance", copyFor(c.e164).attendanceSaved(trip.name, parsed === "attending" ? "attending" : "maybe"));
}

async function answerDecline(c: Conversation, trip: EnrolledTrip, question: QuestionRow) {
  const answer = parseYesNo(c.message.body);
  if (answer === "unclear") { await reply(c, trip, "decline_again", `${trip.name}: reply YES to confirm you can't make it, or NO to keep things as they are.`); return; }
  if (answer === "no") { await closeQuestion(question.id, "cancelled", "kept", dbOptions(c.deps)); await reply(c, trip, "decline_kept", copyFor(c.e164).attendanceDeclineKept(trip.name)); return; }
  if (!(await saveAttendance(c, trip, "declined"))) return;
  await closeQuestion(question.id, "answered", "declined", dbOptions(c.deps));
  await reply(c, trip, "declined", copyFor(c.e164).attendanceDeclined(trip.name));
}

/** Through the existing attendance command, as the person, bound to the dates they were asked about. */
async function saveAttendance(c: Conversation, trip: EnrolledTrip, state: "attending" | "helping" | "declined") {
  try {
    await setEventAttendance(trip.slug, { commandId: deterministicUuid(`sms:${c.message.id}:attendance:${state}`), state, reviewedDates: eventAttendanceDates(trip.startsOn, trip.endsOn) }, { databaseUrl: c.deps.databaseUrl, actorPersonId: c.person.id });
    return true;
  } catch (error) {
    if (error instanceof CommandAccessError) await reply(c, trip, "no_access", copyFor(c.e164).noMembership(trip.name));
    else if (error instanceof AttendanceReviewError || error instanceof CommandConflictError) await reply(c, trip, "attendance_web", copyFor(c.e164).attendanceOnWeb(trip.name, tripUrl(c.deps, trip)));
    else throw error;
    return false;
  }
}

async function answerPoll(c: Conversation, trip: EnrolledTrip, question: QuestionRow, aside: () => Promise<boolean>) {
  const { deps } = c;
  const pollUrl = `${deps.origin}${publicPollPath(question.refId!)}`;
  const auth = await personAuth(c.person.id, dbOptions(deps));
  const poll = auth?.authUserId ? await getPublicPollByPublicId(question.refId!, deps.databaseUrl, { authUserId: auth.authUserId, email: null }) : null;
  const simple = poll ? simplePollQuestion(poll) : null;
  const multiple = simple?.selectionMode === "multiple";
  const parseable = question.options.map(option => ({ ...option, exclusive: simple?.options.find(item => item.id === option.value)?.exclusive ?? false }));
  const keys = multiple ? parseMultiOptionReply(c.message.body, parseable)?.keys : (key => key ? [key.key] : undefined)(parseOptionReply(c.message.body, question.options));
  if (!keys) { if (await aside()) return; await reply(c, trip, "poll_unclear", copyFor(c.e164).pollUnclear(trip.name, question.options.map(option => option.key), multiple)); return; }
  const chosen = keys.map(key => question.options.find(item => item.key === key)!);
  if (!poll || !simple || !chosen.every(option => simple.options.some(item => item.id === option.value))) { await reply(c, trip, "poll_web", `${copyFor(c.e164).pollUnavailable(trip.name)} ${pollUrl}`); return; }
  try {
    await submitPublicPollResponseByPublicId(question.refId!, { respondentName: "", answers: [{ questionId: simple.id, optionIds: chosen.map(option => option.value), text: null }] }, deps.databaseUrl, { authUserId: auth!.authUserId!, email: null });
  } catch (error) {
    if (error instanceof PollRepositoryError) { await reply(c, trip, "poll_web", `${copyFor(c.e164).pollUnavailable(trip.name)} ${pollUrl}`); return; }
    throw error;
  }
  await closeQuestion(question.id, "answered", chosen.map(option => option.value).join(",").slice(0, 400), dbOptions(deps));
  await reply(c, trip, "poll", copyFor(c.e164).pollSaved(trip.name, chosen.map(option => option.label), pollUrl));
}

// ---- Free text ----------------------------------------------------------------------------------------------------------------------------------

async function freeText(c: Conversation, trip: EnrolledTrip, open: QuestionRow[]) {
  if (await handleBookingMessage(c, trip)) return;
  if (await handleMoneyMessage(c, trip)) return;
  const review = open.find(question => question.commonsId === trip.id && question.kind === "booking_review" && question.expiresAt > c.deps.now());
  if (review && parseYesNo(c.message.body) !== "unclear") { await reply(c, trip, "remind", `${trip.name}: to save those booking details, reply SAVE ${review.approvalCode}. Reply DISCARD to drop them.`); return; }
  const answered = await answerPlanQuestion(c, trip);
  if (answered) { await reply(c, trip, "plan", answered); return; }
  await reply(c, trip, "none", copyFor(c.e164).noOpenQuestion(trip.name));
}

/**
 * The reply to a question about the saved plan this person is already allowed to see (their own permission-filtered snapshot). No model, no guessing:
 * an unknown stays unknown. Returns null when the message is not a plan question at all.
 */
export async function answerPlanQuestion(c: Conversation, trip: EnrolledTrip): Promise<string | null> {
  const snapshot = await snapshotOf(c.deps, trip.slug, c.person.id);
  const answer = answerFromSavedPlan({ body: c.message.body, now: c.deps.now(), timezone: trip.timezone, tripName: trip.name, startsOn: trip.startsOn, endsOn: trip.endsOn, personId: c.person.id, itinerary: snapshot.state.itinerary, stays: snapshot.state.stays ?? [], travelPlans: snapshot.state.travelPlans ?? [] });
  const copy = copyFor(c.e164);
  switch (answer.kind) {
    case "answer": return copy.planAnswer(trip.name, answer.text);
    case "not_on_stay": return copy.planNotOnStay(trip.name, answer.stayName, answer.people);
    case "unknown": return copy.planUnknown(trip.name);
    case "none": return null;
  }
}
