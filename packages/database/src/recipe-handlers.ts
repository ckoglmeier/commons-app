import {
  ApproveFoodSchema, buildFoodPollData, summarizeFoodResponses, type FoodSummary,
  aggregatePollAnswers,
  ApproveAttendanceSchema, ApproveLodgingSchema, ApproveRecipeOutcomeSchema,
  alternativesFromQuestions, attendanceQuestions, buildAttendancePollData, buildDatesLocationPollData, buildLodgingPollData, childrenAsked, datesLocationQuestions,
  formatAlternativeLabel, lodgingQuestions, propertiesFromQuestions, summarizeAlternatives, summarizeAttendance, summarizeLodging,
  type AttendanceEntry, type AttendanceResponseFact, type LodgingResponseFact, type PollWorkingData, type RecipeId, type RecipeOutcome, type RecipeRunDetail, type TripDatesLocation,
} from "@commons/contracts";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { CommandTransaction } from "./event-command";
import { PollRepositoryError } from "./poll-repository";
import { memberships, people, pollResponses, polls } from "./schema";

/**
 * Code-owned recipe behavior. A handler turns validated organizer inputs into a poll draft, reads that poll's answers into a transparent
 * summary, and turns one organizer decision into a typed outcome. Admin-authored recipe text can guide drafting but cannot add a handler,
 * a tool, a transition or a permission.
 */
type Poll = typeof polls.$inferSelect;
export type CurrentAttendance = { outcomeId: string; headcountIn: number; headcountMaybe: number; approvedAt: string };
export type HandlerContext = { tx: CommandTransaction; commonsId: string; trip: TripDatesLocation; attendance: CurrentAttendance | null; actorName: string };
export type Approval = { result: RecipeOutcome; selected: Array<{ questionId: string; optionId: string }>; summary: string; needResolutions: Array<{ responseId: string; questionId: string; resolution: string }> };
type Notes = RecipeRunDetail["notes"];

type ResponseRow = { id: string; personId: string | null; name: string; answers: typeof pollResponses.$inferSelect["answers"] };
async function readResponses(tx: CommandTransaction, pollId: string): Promise<ResponseRow[]> {
  return tx.select({ id: pollResponses.id, personId: pollResponses.respondentPersonId, name: pollResponses.respondentName, answers: pollResponses.answers })
    .from(pollResponses).where(eq(pollResponses.pollId, pollId)).orderBy(asc(pollResponses.submittedAt), asc(pollResponses.id));
}
async function readAudience(tx: CommandTransaction, poll: Poll) {
  const ids = poll.audience?.personIds ?? [];
  const named = ids.length ? await tx.select({ id: people.id, name: people.displayName }).from(people).where(inArray(people.id, ids)) : [];
  return named.map(person => ({ key: person.id, name: person.name })).sort((a, b) => a.name.localeCompare(b.name));
}
const keyOf = (row: ResponseRow) => row.personId ?? `guest:${row.name.trim().toLocaleLowerCase()}`;
function notesOf(rows: ResponseRow[]): Notes {
  return rows.flatMap(row => row.answers.flatMap(answer => answer.context ? [{ responseId: row.id, questionId: answer.questionId, respondentName: row.name, kind: answer.context.kind, text: answer.context.text }] : []));
}
const cap = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;

export type RecipeHandler = {
  recipe: Extract<RecipeId, "dates_location" | "attendance" | "lodging" | "food_preferences">;
  /** Whether approving can offer to change trip records. Only date and location results can; every other result is context. */
  appliesToTrip: boolean;
  /** Build or rebuild the private draft from validated inputs. `previous` keeps question identity across edits. */
  draft(ctx: HandlerContext, input: Record<string, unknown>, previous: PollWorkingData | null): PollWorkingData;
  /** Read the poll's answers into the recipe-specific part of the run detail. */
  view(ctx: HandlerContext, poll: Poll | null, draft: PollWorkingData): Promise<{ detail: Record<string, unknown>; notes: Notes }>;
  /** Validate one organizer decision against the closed round and produce the typed outcome. */
  approve(ctx: HandlerContext, poll: Poll, raw: unknown): Promise<Approval>;
};

/* ---------- Dates and location ---------- */

const datesLocation: RecipeHandler = {
  recipe: "dates_location", appliesToTrip: true,
  draft: (_ctx, input, previous) => input.alternatives || input.configuration ? buildDatesLocationPollData({ alternatives: input.alternatives as never, configuration: input.configuration as never, title: input.title as string | undefined, previous }) : { title: (input.title as string) || "Which dates and place work for you?", intro: "Choose the date-and-place options to ask your group about.", ballotMode: "transparent", questions: [] },
  async view({ tx }, poll, draft) {
    const questions = poll?.questions ?? draft.questions as never;
    const alternatives = alternativesFromQuestions(questions);
    const base = { alternatives, questions, configuration: draft.recipeConfiguration, exploratory: !datesLocationQuestions(questions) };
    if (!poll) return { detail: { ...base, summary: null }, notes: [] };
    const found = datesLocationQuestions(poll.questions);
    const rows = await readResponses(tx, poll.id);
    const resultsVisible = poll.ballotMode === "transparent" || poll.status === "closed";
    const ballotResults = { questions: poll.questions, aggregates: resultsVisible ? poll.questions.filter(question => !question.organizerOnly).map(question => aggregatePollAnswers(question, rows)) : [], responseCount: rows.length, resultsVisible, identityBound: Boolean(poll.audience) };
    if (poll.ballotMode === "secret") return { detail: { ...base, exploratory: true, summary: null, ballotResults }, notes: [] };
    if (!found) return { detail: { ...base, summary: null, ballotResults }, notes: notesOf(rows) };
    const neither = found.acceptable.options.find(option => option.exclusive)?.id ?? null;
    const responses = rows.map(row => {
      const acceptable = row.answers.find(answer => answer.questionId === found.acceptable.id), preferred = found.preferred ? row.answers.find(answer => answer.questionId === found.preferred!.id) : undefined;
      return { key: keyOf(row), name: row.name, acceptable: (acceptable?.optionIds ?? []).filter(id => id !== neither), neither: Boolean(neither && acceptable?.optionIds.includes(neither)),
        preferred: preferred?.optionIds[0] ?? null, hasNeed: row.answers.some(answer => answer.context?.kind === "need") };
    });
    return { detail: { ...base, ballotResults, summary: summarizeAlternatives({ alternatives, responses, audience: await readAudience(tx, poll) }) }, notes: notesOf(rows) };
  },
  async approve(ctx, poll, raw) {
    if (poll.ballotMode !== "transparent") throw new PollRepositoryError("invalid_response", "Date-and-place approval needs named feasibility answers. Secret preferences cannot establish a group fit.");
    const input = ApproveRecipeOutcomeSchema.parse(raw);
    const found = datesLocationQuestions(poll.questions);
    const option = found?.acceptable.options.find(item => item.id === input.alternativeId && item.alternative);
    if (!found || !option?.alternative) throw new PollRepositoryError("invalid_response", "Choose one of the options that was asked about.");
    const { detail } = await datesLocation.view(ctx, poll, { title: poll.title, intro: poll.intro, ballotMode: poll.ballotMode, questions: poll.questions });
    const summary = detail.summary as ReturnType<typeof summarizeAlternatives>;
    const row = summary.rows.find(item => item.alternative.id === input.alternativeId)!;
    const exceptions = input.exceptions.map(item => item.trim());
    return {
      result: { kind: "dates_location", alternativeId: option.id, startsOn: option.alternative.startsOn, endsOn: option.alternative.endsOn, place: option.alternative.place, exceptions,
        basis: { respondedCount: summary.respondedCount, askedCount: summary.askedCount, awaitingCount: summary.awaiting.length, acceptedCount: row.acceptedBy.length, preferredCount: row.preferredBy.length } },
      selected: [{ questionId: found.acceptable.id, optionId: option.id }], needResolutions: input.needResolutions,
      summary: cap(`Chose ${formatAlternativeLabel(option.alternative)}.`, 500),
    };
  },
};

/* ---------- Attendance ---------- */

async function attendanceFacts(ctx: HandlerContext, poll: Poll) {
  const found = attendanceQuestions(poll.questions)!;
  const rows = await readResponses(ctx.tx, poll.id);
  const facts: AttendanceResponseFact[] = rows.map(row => {
    const state = row.answers.find(answer => answer.questionId === found.state.id)?.optionIds[0], size = found.party ? row.answers.find(answer => answer.questionId === found.party!.id)?.optionIds[0] : undefined;
    const note = found.note ? row.answers.find(answer => answer.questionId === found.note!.id)?.text ?? null : null;
    return { key: keyOf(row), name: row.name, responseId: row.id, guest: !row.personId, state: found.state.options.find(option => option.id === state)?.attendance ?? null,
      partySize: found.party?.options.find(option => option.id === size)?.partySize ?? null, note: note || null, hasNeed: row.answers.some(answer => answer.context?.kind === "need") };
  });
  return { found, rows, facts, audience: await readAudience(ctx.tx, poll) };
}

const attendance: RecipeHandler = {
  recipe: "attendance", appliesToTrip: false,
  draft: (ctx, input, previous) => buildAttendancePollData({ trip: ctx.trip, title: input.title as string | undefined, previous }),
  async view(ctx, poll) {
    if (!poll) return { detail: { summary: null, people: await roster(ctx) }, notes: [] };
    const { rows, facts, audience } = await attendanceFacts(ctx, poll);
    return { detail: { summary: summarizeAttendance({ audience, responses: facts, entries: [] }), people: await roster(ctx) }, notes: notesOf(rows) };
  },
  async approve(ctx, poll, raw) {
    const input = ApproveAttendanceSchema.parse(raw);
    const { facts, audience } = await attendanceFacts(ctx, poll);
    const responseIds = new Set(facts.map(fact => fact.responseId));
    if (input.excludedResponseIds.some(id => !responseIds.has(id))) throw new PollRepositoryError("invalid_response", "Choose from the answers on this poll.");
    // Exclusion resolves duplicate self-reported guest answers only; it cannot erase a verified answer.
    for (const id of input.excludedResponseIds) {
      const fact = facts.find(item => item.responseId === id)!;
      if (!fact.guest || facts.filter(item => item.guest && item.key === fact.key).length < 2)
        throw new PollRepositoryError("invalid_response", "Only duplicate guest answers can be excluded. A person’s own answer is kept.");
    }
    // An organizer-entered note is attributed to the organizer, never to the person, and only for someone who has not answered.
    const members = await roster(ctx), memberIds = new Set(members.map(member => member.personId));
    const answered = new Set(facts.filter(fact => fact.state).map(fact => fact.key));
    const entries: AttendanceEntry[] = [];
    for (const entry of input.organizerEntries) {
      if (!memberIds.has(entry.personId)) throw new PollRepositoryError("invalid_response", "That person isn’t on this trip.");
      const name = members.find(member => member.personId === entry.personId)!.name.trim().toLocaleLowerCase();
      // A link poll takes a self-reported name, so a same-named answer may be this person. Never guess: the organizer resolves it.
      if (answered.has(entry.personId) || facts.some(fact => fact.state && fact.name.trim().toLocaleLowerCase() === name))
        throw new PollRepositoryError("invalid_response", "That person already answered. Their own answer is used. Remove your note about them.");
      entries.push({ key: entry.personId, name: members.find(member => member.personId === entry.personId)!.name, state: entry.state, partySize: entry.partySize, note: entry.note, enteredBy: ctx.actorName });
    }
    // Members of the trip who are not in the poll audience (for example a link poll) are still named when an organizer enters them.
    const summary = summarizeAttendance({ audience, responses: facts, entries, excludedResponseIds: input.excludedResponseIds });
    if (summary.duplicates.length) throw new PollRepositoryError("invalid_response", `${summary.duplicates.map(item => item.name).join(", ")} answered more than once as a guest. Choose which answer to count.`);
    if (!summary.people.some(person => person.state !== "unanswered")) throw new PollRepositoryError("invalid_response", "Add an attendance answer or an organizer-attributed note before recording a result. The earlier decision has not changed.");
    const text = `Attendance when voting closed: ${summary.counts.in} in, ${summary.counts.maybe} maybe, ${summary.counts.out} out, ${summary.counts.unanswered} not answered. Nobody’s own RSVP changed.`;
    const exceptions = input.exceptions.map(item => item.trim());
    return {
      result: { kind: "attendance", counts: summary.counts, headcount: { in: summary.headcount.in, maybe: summary.headcount.maybe }, exceptions, excludedResponses: input.excludedResponseIds.length,
        people: summary.people.slice(0, 200).map(person => ({ personId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(person.key) ? person.key : null, name: person.name, state: person.state, partySize: person.partySize, source: person.source, note: person.note ? cap(person.note, 1000) : null, enteredBy: person.enteredBy })),
        basedOn: ctx.trip },
      selected: [], needResolutions: input.needResolutions, summary: cap(text, 500),
    };
  },
};
async function roster(ctx: HandlerContext) {
  const rows = await ctx.tx.select({ personId: people.id, name: people.displayName }).from(memberships).innerJoin(people, eq(people.id, memberships.personId))
    .where(and(eq(memberships.commonsId, ctx.commonsId), eq(memberships.status, "active")));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------- Lodging ---------- */

async function lodgingFacts(ctx: HandlerContext, poll: Poll) {
  const found = lodgingQuestions(poll.questions)!, neither = found.acceptable.options.find(option => option.exclusive)?.id ?? null, preferredId = found.preferred?.id;
  const rows = await readResponses(ctx.tx, poll.id);
  const responses: LodgingResponseFact[] = rows.map(row => {
    const acceptable = row.answers.find(answer => answer.questionId === found.acceptable.id), preferred = found.preferred ? row.answers.find(answer => answer.questionId === preferredId) : undefined;
    const sleeping = found.sleeping ? row.answers.find(answer => answer.questionId === found.sleeping!.id)?.optionIds[0] : undefined;
    const child = found.children ? row.answers.find(answer => answer.questionId === found.children!.id)?.optionIds[0] : undefined;
    return { key: keyOf(row), name: row.name, acceptable: (acceptable?.optionIds ?? []).filter(id => id !== neither), neither: Boolean(neither && acceptable?.optionIds.includes(neither)),
      preferred: preferred?.optionIds[0] ?? null, sleeping: found.sleeping?.options.find(option => option.id === sleeping)?.sleeping ?? null,
      children: found.children ? found.children.options.find(option => option.id === child)?.label === "Yes" ? true : child ? false : null : null,
      hasNeed: row.answers.some(answer => answer.context?.kind === "need") };
  });
  return { found, rows, responses, audience: await readAudience(ctx.tx, poll), properties: propertiesFromQuestions(poll.questions) };
}

const lodging: RecipeHandler = {
  recipe: "lodging", appliesToTrip: false,
  draft: (ctx, input, previous) => input.properties ? buildLodgingPollData({ properties: input.properties as never, trip: ctx.trip, askAboutChildren: Boolean(input.askAboutChildren), title: input.title as string | undefined, previous }) : { title: (input.title as string) || "Where should we stay?", intro: "Add the places you want the group to compare.", ballotMode: "transparent", recipeTrip: ctx.trip, questions: [] },
  async view(ctx, poll, draft) {
    const questions = (poll?.questions ?? draft.questions) as never;
    const properties = propertiesFromQuestions(questions), base = { properties, askAboutChildren: childrenAsked(questions) };
    if (!poll) return { detail: { ...base, summary: null }, notes: [] };
    const { rows, responses, audience } = await lodgingFacts(ctx, poll);
    return { detail: { ...base, summary: summarizeLodging({ properties, responses, audience }) }, notes: notesOf(rows) };
  },
  async approve(ctx, poll, raw) {
    const input = ApproveLodgingSchema.parse(raw);
    const facts = await lodgingFacts(ctx, poll);
    const property = facts.properties.find(item => item.id === input.optionId);
    if (!property) throw new PollRepositoryError("invalid_response", "Choose one of the places that was asked about.");
    const summary = summarizeLodging({ properties: facts.properties, responses: facts.responses, audience: facts.audience });
    const row = summary.rows.find(item => item.property.id === property.id)!;
    // Every conflict on screen for this place must be named in the approval, so approving can never hide one.
    const missing = row.conflicts.filter(conflict => !input.acknowledgedConflicts.includes(conflict));
    if (missing.length) throw new PollRepositoryError("invalid_response", "Review the room and bed conflicts for this place before approving it.");
    const exceptions = input.exceptions.map(item => item.trim());
    return {
      result: { kind: "lodging", optionId: property.id, name: property.name, url: property.url, rooms: property.rooms, beds: property.beds, pricing: row.pricing,
        acceptedCount: row.acceptedBy.length, preferredCount: row.preferredBy.length, respondedCount: summary.respondedCount, awaitingCount: summary.awaiting.length,
        conflictsAcknowledged: row.conflicts, exceptions,
        ...(input.participantSummary ? { participantSummary: input.participantSummary } : {}),
        basedOn: { trip: ctx.trip, attendanceOutcomeId: ctx.attendance?.outcomeId ?? null, headcountIn: ctx.attendance?.headcountIn ?? null, headcountMaybe: ctx.attendance?.headcountMaybe ?? null } },
      selected: [{ questionId: facts.found.acceptable.id, optionId: property.id }], needResolutions: input.needResolutions,
      summary: input.participantSummary ?? cap(`Chose ${property.name} as the group’s preferred place to stay. This is a preference, not a booking. Confirm sleeping setup, final price and availability before booking.`, 500),
    };
  },
};

const food: RecipeHandler = {
  recipe: "food_preferences", appliesToTrip: false,
  draft: (_ctx, input, previous) => buildFoodPollData({ title: input.title as string | undefined, intro: input.intro as string | null | undefined, questions: input.questions as Parameters<typeof buildFoodPollData>[0]["questions"], previous }),
  async view(ctx, poll) {
    if (!poll) return { detail: { summary: null }, notes: [] };
    const rows = await readResponses(ctx.tx, poll.id);
    const summary = summarizeFoodResponses(poll.questions, rows);
    return { detail: { summary }, notes: notesOf(rows) };
  },
  async approve(ctx, poll, raw) {
    const input = ApproveFoodSchema.parse(raw);
    const { detail } = await food.view(ctx, poll, { title: poll.title, intro: poll.intro, ballotMode: poll.ballotMode, questions: poll.questions });
    return { result: { kind: "food_preferences", summary: detail.summary as FoodSummary }, selected: [],
      needResolutions: input.needResolutions,
      summary: "Recorded food preferences for organizer meal planning. Restaurant accommodation has not been confirmed." };
  },
};
export const recipeHandlers = { dates_location: datesLocation, attendance, lodging, food_preferences: food } as const;
export function recipeHandler(recipe: string): RecipeHandler | null { return (recipeHandlers as Record<string, RecipeHandler>)[recipe] ?? null; }
