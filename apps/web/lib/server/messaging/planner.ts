import { eventAttendanceDates } from "@commons/contracts";
import {
    closeQuestion, consentedMembers, consentedNumber, consentedPairs, getPublicPollByPublicId, hasQueuedProactive, membershipAttendance, messageKeyExists, openIntakes, openQuestion, openQuestionsForPerson, personAuth,
    isWebAddress, recentQuestions, tripInfo, type EnrolledTrip, type QuestionRow,
} from "@commons/database";
import { nextSteps, QUESTION_TTL_MS, thingsToDo, type MessagingCopy } from "@commons/domain";
import { buildMoneySummary, moneySummaryViewerBalances } from "@/lib/money-summary";
import { publicPollPath } from "@/lib/poll-route";
import { copyFor, dbOptions, firstName, queue, snapshotOf, stable, tripUrl, type MessagingDeps, type Person } from "./core";

/** One welcome per trip per place: moving a trip from a phone to the web thread (or back) says hello again there. */
const welcomeKey = (tripId: string, personId: string, address: string) => `welcome:${tripId}:${personId}${isWebAddress(address) ? ":web" : ""}`;

/*
 * What Commons asks next, and whether a question is still worth asking. The selection reuses the channel-neutral next-step and things-to-do
 * selectors over the person's own, permission-filtered snapshot instead of keeping a second list of rules. It never sends and never saves.
 */
export const ymd = (date: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

export type PlannedQuestion = {
  /** poll_link isn't a question: the poll is more than a text can ask, so Commons says where to answer it, once, and nothing waits on a reply. */
  kind: "attendance" | "poll" | "arrival" | "poll_link";
  refId: string; version: string; options: Array<{ key: string; label: string; value: string }>;
  /** The question as it is asked after the trip name, e.g. "are you in for Jun 12 to Jun 14? Reply YES, NO or MAYBE.", in the words of where it goes. */
  text: (copy: MessagingCopy) => string;
};
const SUPPRESS_AFTER_ANSWER_MS = 7 * 86_400_000;

type Trip = Pick<EnrolledTrip, "id" | "slug" | "name" | "startsOn" | "endsOn" | "timezone" | "status">;
const pollVersion = (poll: { status: string; questions: Array<{ id: string; options?: Array<{ id: string }> }> }) => `${poll.status}:${poll.questions.map(question => `${question.id}[${(question.options ?? []).map(option => option.id).join(",")}]`).join(";")}`;

/**
 * A poll a traveler can answer with one reply: one choice question, two to six plain options, picking one or several. An optional written question beside
 * it doesn't change that, because it can be left blank. Everything else is answered on the web.
 */
export function simplePollQuestion(poll: { status: string; questions: Array<Record<string, any>> }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (poll.status !== "open") return null;
  const asked = poll.questions.filter(question => !(question.kind === "text" && !question.required));
  if (asked.length !== 1) return null;
  const question = asked[0]!;
  if (question.kind !== "choice" || !["single", "multiple"].includes(question.selectionMode) || question.itinerary || question.availability) return null;
  const options = (question.options ?? []) as Array<{ id: string; label: string; exclusive?: boolean }>;
  return options.length >= 2 && options.length <= 6 ? { id: question.id as string, prompt: question.prompt as string, options, selectionMode: question.selectionMode as "single" | "multiple" } : null;
}
const pollNoticeKey = (tripId: string, personId: string, publicId: string) => `pollnotice:${tripId}:${personId}:${publicId}`;

async function viewerFor(deps: MessagingDeps, personId: string) {
  const auth = await personAuth(personId, dbOptions(deps));
  return auth?.authUserId ? { authUserId: auth.authUserId, email: null } : null;
}

const snapshotFor = snapshotOf;

/** The next single question for this person on this trip, or null. One at a time, in a fixed order: attendance, a simple poll, missing travel. */
export async function planNextQuestion(deps: MessagingDeps, person: Person, trip: Trip): Promise<PlannedQuestion | null> {
  const now = deps.now();
  if (["closing", "archived"].includes(trip.status) || (trip.endsOn && trip.endsOn < ymd(now, trip.timezone))) return null;
  const attendance = await membershipAttendance(person.id, trip.id, dbOptions(deps));
  if (attendance?.status !== "active") return null;
  const recent = async (kind: QuestionRow["kind"]) => (await recentQuestions(person.id, trip.id, kind, SUPPRESS_AFTER_ANSWER_MS, dbOptions(deps))).some(question => question.status === "answered");

  if (attendance.state === "helping" && trip.startsOn && trip.endsOn && !(await recent("attendance"))) {
    return { kind: "attendance", refId: "attendance", version: `${eventAttendanceDates(trip.startsOn, trip.endsOn)}:helping`, options: [], text: copy => copy.attendance(trip.name, trip.startsOn, trip.endsOn).slice(trip.name.length + 2) };
  }
  const snapshot = await snapshotFor(deps, trip.slug, person.id);
  const intakes = (await openIntakes(person.id, trip.id, dbOptions(deps))).map(row => ({ id: row.id, commonsId: row.commonsId, ownerPersonId: row.personId, kind: row.draft?.kind ?? "flight", revision: row.version, draft: row.draft ?? null,
    status: ["received", "extracting"].includes(row.status) ? "processing" : ["needs_info", "awaiting_review"].includes(row.status) ? "awaiting_review" : "failed" }));
  const travel = nextSteps({ commons: snapshot.commons, state: snapshot.state, participants: snapshot.participants, personId: person.id, now: now.getTime(), travelState: "loaded", intakes, intakeState: "loaded" }).steps[0];
  const items = thingsToDo({ tripId: snapshot.commons.id, personId: person.id, organizer: false, state: snapshot.state, goals: [], tripTasks: [], today: ymd(now, trip.timezone), travel });

  const viewer = await viewerFor(deps, person.id);
  for (const item of items.filter(item => item.source === "poll")) {
    const request = snapshot.state.pollRequests?.find(poll => poll.id === item.target.id);
    const poll = request && viewer ? await getPublicPollByPublicId(request.publicId, deps.databaseUrl, viewer) : null;
    if (!poll) continue;
    const simple = simplePollQuestion(poll);
    if (!simple) {
      if (poll.status === "open" && !(await messageKeyExists(pollNoticeKey(trip.id, person.id, request!.publicId), dbOptions(deps)))) {
        return { kind: "poll_link", refId: request!.publicId, version: pollVersion(poll), options: [], text: copy => copy.pollLink(trip.name, poll.title, `${deps.origin}${publicPollPath(request!.publicId)}`).slice(trip.name.length + 2) };
      }
      continue;
    }
    const options = simple.options.map((option, index) => ({ key: String(index + 1), label: option.label, value: option.id }));
    return { kind: "poll", refId: request!.publicId, version: pollVersion(poll), options, text: copy => copy.poll(trip.name, simple.prompt || poll.title, options, simple.selectionMode === "multiple").slice(trip.name.length + 2) };
  }
  const missing = items.find(item => item.source === "travel" && item.id.startsWith("arrival_"));
  if (missing && ["arrival_missing", "arrival_time_missing"].some(prefix => missing.id.startsWith(prefix)) && !(await recent("arrival")) && !(await recentQuestions(person.id, trip.id, "arrival", 14 * 86_400_000, dbOptions(deps))).some(question => question.status === "open")) {
    return { kind: "arrival", refId: "arrival", version: missing.id.split(":")[0]!, options: [], text: copy => copy.arrival(trip.name).slice(trip.name.length + 2) };
  }
  return null;
}

/**
 * Is the question still needed, and is it the question that was asked? "resolved" means the work was done elsewhere (on the web, or by another
 * message); "changed" means what it was about moved after it was asked, so an answer to the old wording must not be applied to the new thing.
 */
export async function questionState(deps: MessagingDeps, question: QuestionRow, person: Person): Promise<"open" | "resolved" | "changed"> {
  if (question.status !== "open") return "resolved";
  const trip = await tripInfo(question.commonsId, dbOptions(deps));
  if (!trip) return "resolved";
  if (question.kind === "attendance" || question.kind === "attendance_decline") {
    const attendance = await membershipAttendance(person.id, question.commonsId, dbOptions(deps));
    if (attendance?.status !== "active") return "resolved";
    if (attendance.state !== "helping") return "resolved";
    return question.version === `${eventAttendanceDates(trip.startsOn, trip.endsOn)}:helping` ? "open" : "changed";
  }
  if (question.kind === "poll") {
    const snapshot = await snapshotFor(deps, trip.slug, person.id);
    const request = snapshot.state.pollRequests?.find(poll => poll.publicId === question.refId);
    if (!request || request.responded) return "resolved";
    const viewer = await viewerFor(deps, person.id);
    const poll = viewer ? await getPublicPollByPublicId(question.refId!, deps.databaseUrl, viewer) : null;
    return poll && pollVersion(poll) === question.version ? "open" : poll?.status === "open" ? "changed" : "resolved";
  }
  if (question.kind === "arrival") {
    const snapshot = await snapshotFor(deps, trip.slug, person.id);
    const steps = nextSteps({ commons: snapshot.commons, state: snapshot.state, participants: snapshot.participants, personId: person.id, now: deps.now().getTime(), travelState: "loaded", intakes: [], intakeState: "loaded" });
    return steps.travelThere === "saved" ? "resolved" : "open";
  }
  return "open";
}

const isUniqueViolation = (error: unknown): boolean => typeof error === "object" && error !== null && ((error as { code?: unknown }).code === "23505" || isUniqueViolation((error as { cause?: unknown }).cause));

/** Open the question and queue it as a proactive message. Asking again after expiry is one reminder; a third ask is never queued. */
export async function askQuestion(deps: MessagingDeps, person: Person, trip: Trip, planned: PlannedQuestion, options: { welcome?: { startsOn: string | null; endsOn: string | null }; purpose?: string } = {}) {
  const number = await consentedNumber(person.id, trip.id, "conversation", dbOptions(deps));
  if (!number) return null;
  if (planned.kind === "poll_link") {
    const notice = await queue({ deps, e164: number.e164, person }, { key: pollNoticeKey(trip.id, person.id, planned.refId), purpose: "proactive:poll_link", body: `${trip.name}: ${planned.text(copyFor(number.e164))}`, tripId: trip.id });
    return notice.created ? { question: null, message: notice.message } : null;
  }
  const earlier = (await recentQuestions(person.id, trip.id, planned.kind, 30 * 86_400_000, dbOptions(deps))).filter(question => question.refId === planned.refId && question.version === planned.version);
  if (earlier.length >= 2) return null;
  // Two passes at once (a second tab, a page load racing the scheduled pass) can both reach the insert. The one that loses hits the one-open-question
  // index; the question is then already asked, so it ends here instead of failing.
  let question: Awaited<ReturnType<typeof openQuestion>>;
  try { question = await openQuestion({ personId: person.id, commonsId: trip.id, kind: planned.kind, refId: planned.refId, version: planned.version, options: planned.options, expiresAt: new Date(deps.now().getTime() + QUESTION_TTL_MS) }, dbOptions(deps)); }
  catch (error) { if (isUniqueViolation(error)) return null; throw error; }
  const copy = copyFor(number.e164), body = options.welcome
    ? copy.welcome({ firstName: firstName(person.name), tripName: trip.name, startsOn: options.welcome.startsOn, endsOn: options.welcome.endsOn, question: planned.text(copy) })
    : `${trip.name}: ${planned.text(copy)}`;
  const key = `ask:${trip.id}:${person.id}:${planned.kind}:${stable(planned.refId, planned.version)}:${earlier.length + 1}`;
  const queued = await queue({ deps, e164: number.e164, person }, { key: options.welcome ? welcomeKey(trip.id, person.id, number.e164) : key, purpose: options.purpose ?? `proactive:${planned.kind}`, body, tripId: trip.id, questionId: question.id });
  return { question, message: queued.message };
}

/**
 * The welcome, once per membership. It is queued only when every prerequisite holds (active membership, verified number, granted consent) and the
 * stable key makes a repeat (reopened invitation, retried enrollment) a no-op. If there is no useful first question it still says how to use the channel.
 */
export async function queueWelcome(deps: MessagingDeps, person: Person, tripId: string) {
  const trip = await tripInfo(tripId, dbOptions(deps));
  const number = trip ? await consentedNumber(person.id, tripId, "conversation", dbOptions(deps)) : null;
  if (!trip || !number) return null;
  const planned = await planNextQuestion(deps, person, trip);
  // A link to a long poll is a poor first text. It comes with the next pass, after the welcome.
  if (planned && planned.kind !== "poll_link") return askQuestion(deps, person, trip, planned, { welcome: { startsOn: trip.startsOn, endsOn: trip.endsOn }, purpose: "proactive:welcome" });
  const copy = copyFor(number.e164), body = copy.welcome({ firstName: firstName(person.name), tripName: trip.name, startsOn: trip.startsOn, endsOn: trip.endsOn, question: copy.welcomeAsk });
  const queued = await queue({ deps, e164: number.e164, person }, { key: welcomeKey(trip.id, person.id, number.e164), purpose: "proactive:welcome", body, tripId: trip.id });
  return { question: null, message: queued.message };
}

/** The proactive step for one person on one trip: if nothing is open and nothing is waiting to go out, ask the one next useful question. */
export async function askNextFor(deps: MessagingDeps, pair: { personId: string; commonsId: string }) {
  const trip = await tripInfo(pair.commonsId, dbOptions(deps));
  const auth = await personAuth(pair.personId, dbOptions(deps));
  if (!trip || !auth) return false;
  const open = (await openQuestionsForPerson(pair.personId, dbOptions(deps))).filter(question => question.expiresAt > deps.now() && !["booking_review", "booking_info", "money_review", "money_info"].includes(question.kind) || question.kind === "trip_choice");
  if (open.length || await hasQueuedProactive(pair.personId, dbOptions(deps))) return false;
  const person = { id: pair.personId, name: auth.displayName };
  const planned = await planNextQuestion(deps, person, trip);
  return Boolean(planned && await askQuestion(deps, person, trip, planned));
}

/** The proactive pass across every consented person. */
export async function planQuestions(deps: MessagingDeps, limit = 200) {
  let asked = 0;
  for (const pair of await consentedPairs(limit, dbOptions(deps))) if (await askNextFor(deps, pair)) asked++;
  return asked;
}

/** Something new on one trip, such as a published poll: its people don't wait for the scheduled pass. Quiet hours and cadence still apply at send time. */
export async function planQuestionsForTrip(deps: MessagingDeps, tripId: string) {
  let asked = 0;
  for (const member of await consentedMembers(tripId, dbOptions(deps))) if (await askNextFor(deps, { personId: member.personId, commonsId: tripId })) asked++;
  return asked;
}

/** Is a queued "this poll is waiting" text still true? Answered or closed since it was queued, it stays home. */
export async function pollNoticeStillNeeded(deps: MessagingDeps, personId: string, tripId: string, publicId: string) {
  const trip = await tripInfo(tripId, dbOptions(deps));
  if (!trip) return false;
  const snapshot = await snapshotOf(deps, trip.slug, personId);
  const request = snapshot.state.pollRequests?.find(poll => poll.publicId === publicId);
  return Boolean(request && !request.responded);
}

/**
 * Tell the people on a trip about a relevant change. Idempotent per person and per change; recipients are those with updates consent, rechecked at
 * send time. The summary is written by the caller from saved facts; Commons never invents a change.
 */
export async function queueTripChange(deps: MessagingDeps, tripId: string, change: { kind: string; summary: string; evidence: string }) {
  const trip = await tripInfo(tripId, dbOptions(deps));
  if (!trip) return 0;
  let queued = 0;
  for (const member of await consentedMembers(tripId, dbOptions(deps))) {
    const number = await consentedNumber(member.personId, tripId, "updates", dbOptions(deps));
    if (!number) continue;
    const result = await queue({ deps, e164: number.e164, person: { id: member.personId, name: "" } }, { key: `change:${tripId}:${member.personId}:${stable(change.kind, change.evidence)}`, purpose: "proactive:change", body: copyFor(number.e164).change(trip.name, change.summary, tripUrl(deps, trip, "plan")), tripId });
    if (result.created) queued++;
  }
  return queued;
}

/** What a person still owes on a finished trip, from the ledger the Money page uses. Currencies are never netted together. */
export async function openBalances(deps: MessagingDeps, personId: string, tripId: string) {
  const trip = await tripInfo(tripId, dbOptions(deps));
  if (!trip || !trip.endsOn || trip.endsOn >= ymd(deps.now(), trip.timezone)) return [];
  const snapshot = await snapshotFor(deps, trip.slug, personId);
  const report = buildMoneySummary(snapshot, deps.now().toISOString());
  if (report.closed) return [];
  return moneySummaryViewerBalances(report).filter(balance => balance.netCents < 0).map(balance => ({ currency: balance.currency, owedCents: -balance.netCents }));
}

export async function queueSettlementReminders(deps: MessagingDeps, tripId: string) {
  const trip = await tripInfo(tripId, dbOptions(deps));
  if (!trip) return 0;
  let queued = 0;
  for (const member of await consentedMembers(tripId, dbOptions(deps))) {
    const owed = await openBalances(deps, member.personId, tripId);
    const number = owed.length ? await consentedNumber(member.personId, tripId, "updates", dbOptions(deps)) : null;
    if (!owed.length || !number) continue;
    const amounts = owed.map(item => `${item.currency} ${(item.owedCents / 100).toFixed(2)}`).join(" and ");
    const result = await queue({ deps, e164: number.e164, person: { id: member.personId, name: "" } }, { key: `settle:${tripId}:${member.personId}:${stable(JSON.stringify(owed))}`, purpose: "proactive:settlement", body: copyFor(number.e164).settlement(trip.name, amounts, tripUrl(deps, trip, "money")), tripId });
    if (result.created) queued++;
  }
  return queued;
}

export { closeQuestion };
