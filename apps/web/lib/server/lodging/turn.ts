import { lodgingShortlistsForRuns, lodgingTripDates, prepareLodgingIntent, recordLodgingShortlist, TripCoordinationError, type CoordinationOptions, type CoordinatorTurnRecord, type LodgingShortlist } from "@commons/database";
import type { CoordinatorThread, CoordinatorWorkspace, RoutedIntent, TurnSourceRef } from "@commons/contracts";
import { lodgingDatesComplete } from "@commons/domain/lodging";
import { buildTripChangeProposal, TripSuggestionSchema, type TripProposalContext } from "@/lib/coordinator-trip-proposal";
import { authenticatedCoordinationOptions, authenticatedTripChangeContext } from "@/lib/server/polls";
import { lodgingPlausible, optionFromChoice, type LodgingRequest } from "./intent";
import { researchSources, researchWorkspace } from "./research-view";
import { resolveLodgingRequest, type ResolverOption } from "./resolve";

/*
 * The Commons-native lodging journey, reached through the coordinator's shared routing (coordinator-turn-service.ts): only a message the deterministic
 * router would otherwise answer or research comes here. It shortlists from the saved dates and shared constraints, then prepares a chosen option as the
 * existing reviewable trip-change proposal with a typed preparation intent. Nothing waits after this turn; the human's apply continues the work
 * (packages/database/src/lodging-continuation.ts). A choice is bound to the shortlist this conversation shows. One bounded structured call (./resolve.ts)
 * is used only when enabled and only for messages about lodging; every reply here is written by Commons, never by the model.
 *
 * This is a fixture-backed lodging workflow: the only research provider is a labeled synthetic catalog, and nothing is booked, held, paid or sent.
 */

/** Commons-written replies. None of them claims a search, booking or saved change that did not happen. */
export const LODGING_REPLIES = {
  datesMissing: "Which dates should I look for? The trip doesn’t have both a start and an end date saved, so I haven’t searched for lodging or prepared anything. Add the dates in Dates and places, then ask me again.",
  noShortlist: "I don’t have a lodging shortlist in this conversation yet. Ask me to find lodging options here first.",
  noMatch: "Which option would you like? I don’t have an option in this conversation’s shortlist that matches that, so tell me its number or name, or ask me to research again.",
  resolverUnavailable: "I couldn’t work out what you meant just now, so I didn’t search, prepare or change anything. Try again, or name the lodging option or its number.",
  tripChangesOff: "Trip updates from chat are turned off right now. You can make the change directly on the trip. Nothing was changed.",
  prepared: "I’ve prepared a trip update below for you to review. Nothing is saved yet. When an organizer applies it, Commons also prepares a booking brief. The brief is preparation only and does not book anything.",
} as const;

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const optionList = (shortlist: LodgingShortlist) => shortlist.run.options.map((option, index) => `${index + 1}. ${option.name}`).join(", ");
const clarifyChoice = (shortlist: LodgingShortlist) => `Which option would you like? ${optionList(shortlist)}. Nothing is prepared until you choose one.`;
function shortlistText(shortlist: LodgingShortlist) {
  const lines = shortlist.run.options.map((option, index) => `${index + 1}. ${option.name}: ${option.bedrooms} bedrooms, ${money(option.nightlyCents)} a night, ${money(option.totalCents)} for the stay.`);
  return `${shortlist.run.synthetic ? "These options come from synthetic fixture evidence, not live prices. " : ""}${lines.join(" ")}`;
}

/** Whether the shared router left this message for an ordinary answer or a request-derived research lookup, the only places native lodging may answer. */
export function lodgingMayHandle(routed: RoutedIntent) {
  return (routed.capability === "answer" && !routed.limitNotice) || (routed.capability === "research" && routed.querySource !== "organizer_typed");
}

/** The lodging shortlists this conversation shows, oldest first, with who asked for each. Read from the saved thread, never from other conversations. */
type ShownShortlist = { shortlist: LodgingShortlist; turnIndex: number; authorPersonId: string | undefined; authorName: string | undefined };
async function shownShortlists(slug: string, turns: CoordinatorThread["turns"], currentTurnId: string, options: CoordinationOptions): Promise<ShownShortlist[]> {
  const shown = turns.map((turn, turnIndex) => ({ turn, turnIndex })).filter(({ turn }) => turn.id !== currentTurnId && turn.workspace?.research)
    .map(({ turn, turnIndex }) => ({ turn, turnIndex, runId: turn.sources?.find(source => source.kind === "research_source")?.researchRunId }))
    .filter((item): item is typeof item & { runId: string } => Boolean(item.runId));
  const saved = await lodgingShortlistsForRuns(slug, [...new Set(shown.map(item => item.runId))], options);
  return shown.flatMap(item => { const shortlist = saved.find(entry => entry.run.runId === item.runId); return shortlist ? [{ shortlist, turnIndex: item.turnIndex, authorPersonId: item.turn.authorPersonId, authorName: item.turn.authorName }] : []; });
}

export type NativeLodgingResult = { assistantText: string; workspace: CoordinatorWorkspace; sources: TurnSourceRef[] };
export type NativeLodgingOutcome = { result: NativeLodgingResult | null; resolverCalled: boolean; resolverMs: number };
export type NativeLodgingInput = {
  turn: CoordinatorTurnRecord; request: LodgingRequest | null; threadTurns: CoordinatorThread["turns"];
  /** Server configuration only: the resolver switch is on and a provider is configured. Never derived from the request. */
  resolverAllowed: boolean; tripChangesEnabled: boolean;
  /** Reserves this attempt's hourly inference slot with the turn's own key; called once, right before the resolver. */
  reserveResolverInference: () => Promise<void>;
  fetcher?: typeof fetch; signal?: AbortSignal; resolverTimeoutMs?: number;
};

const researched = (shortlist: LodgingShortlist, lead: string, tail: string): NativeLodgingResult => ({
  assistantText: `${lead}${shortlistText(shortlist)} ${tail}`.trim().slice(0, 4000), sources: researchSources(shortlist.run),
  workspace: { tripConversation: true, research: researchWorkspace(shortlist.run), capability: "research" },
});
const answered = (assistantText: string): NativeLodgingResult => ({ assistantText, sources: [], workspace: { tripConversation: true } });

/** Null result means "not mine": the shared coordinator path answers exactly as it does with native lodging off. */
export async function runNativeLodgingTurn(slug: string, input: NativeLodgingInput): Promise<NativeLodgingOutcome> {
  const options = await authenticatedCoordinationOptions(slug);
  const outcome: NativeLodgingOutcome = { result: null, resolverCalled: false, resolverMs: 0 };
  const done = (result: NativeLodgingResult | null) => ({ ...outcome, result });
  const { request, turn } = input;
  if (request?.kind === "research") return done(await research(slug, turn, options));

  const shown = await shownShortlists(slug, input.threadTurns, turn.turnId, options);
  const newest = shown.at(-1);
  if (!request && !(input.resolverAllowed && lodgingPlausible(turn.userText, newest?.shortlist.run.options.map(option => option.name) ?? []))) return done(null);
  const resolve = async () => {
    await input.reserveResolverInference();
    outcome.resolverCalled = true;
    const started = Date.now();
    const options: ResolverOption[] = newest?.shortlist.run.options.map(({ optionId, name, bedrooms, nightlyCents, totalCents }) => ({ optionId, name, bedrooms, nightlyCents, totalCents })) ?? [];
    try { return await resolveLodgingRequest(turn.userText, options, { ...(input.fetcher ? { fetcher: input.fetcher } : {}), ...(input.signal ? { signal: input.signal } : {}), ...(input.resolverTimeoutMs ? { timeoutMs: input.resolverTimeoutMs } : {}) }); }
    finally { outcome.resolverMs = Date.now() - started; }
  };

  if (!request) {
    // Only lodging-scoped messages reach here, so an unavailable resolver is answered truthfully; unrelated conversation never waits on it.
    const resolved = await resolve();
    if (resolved.status === "unavailable") return done(answered(LODGING_REPLIES.resolverUnavailable));
    const { resolution } = resolved;
    if (resolution.intent === "other" && !resolution.needsClarification) return done(null);
    if (resolution.intent === "research") return done(await research(slug, turn, options));
    if (!newest) return done(answered(LODGING_REPLIES.noShortlist));
    if (resolution.needsClarification || resolution.intent === "other") return done(answered(clarifyChoice(newest.shortlist)));
    return done(await choose(slug, turn, options, newest.shortlist, newest.shortlist.run.options.find(item => item.optionId === resolution.optionId), input));
  }

  // An explicit choice, bound to the shortlist this conversation shows.
  if (!newest) return done(answered(LODGING_REPLIES.noShortlist));
  // A number is ambiguous when someone else's newer shortlist arrived here after this organizer last spoke: say which list it would mean, prepare nothing.
  const lastOwn = input.threadTurns.findLastIndex(item => item.id !== turn.turnId && item.authorPersonId === turn.actorId);
  if (request.ordinal !== null && shown.length > 1 && newest.authorPersonId !== turn.actorId && newest.turnIndex > lastOwn)
    return done(answered(`There’s a newer shortlist from ${newest.authorName ?? "another organizer"} in this conversation: ${optionList(newest.shortlist)}. Which one do you mean? Tell me its name and I’ll prepare it. Nothing is prepared yet.`));
  let option = optionFromChoice(request, newest.shortlist.run.options);
  if (!option && input.resolverAllowed) {
    const resolved = await resolve();
    if (resolved.status === "unavailable") return done(answered(LODGING_REPLIES.resolverUnavailable));
    if (resolved.resolution.needsClarification) return done(answered(clarifyChoice(newest.shortlist)));
    option = resolved.resolution.intent === "choose" ? newest.shortlist.run.options.find(item => item.optionId === resolved.resolution.optionId) : undefined;
  }
  return done(await choose(slug, turn, options, newest.shortlist, option, input));
}

/** Saved dates are checked before anything is researched: missing or incomplete dates are a completed question, never a shortlist or a failed turn. */
async function research(slug: string, turn: CoordinatorTurnRecord, options: CoordinationOptions, lead = "Here is what I found for the saved dates and shared constraints. ", tail = "Tell me which option you’d like and I’ll prepare it for the organizers to review.", none = "I couldn’t find an option that fits the saved shared constraints. Loosening a limit would change what I can look for.") {
  if (!lodgingDatesComplete(await lodgingTripDates(slug, options))) return answered(LODGING_REPLIES.datesMissing);
  try {
    const shortlist = await recordLodgingShortlist(slug, { commandId: turn.commandId, focus: turn.userText }, options);
    return shortlist ? researched(shortlist, lead, tail) : answered(none);
  } catch (error) {
    if (error instanceof TripCoordinationError && error.code === "dates_required") return answered(LODGING_REPLIES.datesMissing);
    throw error;
  }
}

async function choose(slug: string, turn: CoordinatorTurnRecord, options: CoordinationOptions, shortlist: LodgingShortlist, option: LodgingShortlist["run"]["options"][number] | undefined, input: Pick<NativeLodgingInput, "tripChangesEnabled">): Promise<NativeLodgingResult> {
  if (!option) return answered(LODGING_REPLIES.noMatch);
  if (!input.tripChangesEnabled) return answered(LODGING_REPLIES.tripChangesOff);
  // A shortlist briefed against facts or constraints that have since changed is never turned into a proposal: research again and prepare nothing.
  if (shortlist.run.status !== "current") return refreshed(slug, turn, options);
  const context = await authenticatedTripChangeContext(slug) as unknown as TripProposalContext;
  if (!lodgingDatesComplete(context)) return answered(LODGING_REPLIES.datesMissing);
  const source = `Add a new stay: ${option.name}, ${option.address}, ${money(option.totalCents)} total, chosen from the researched options`;
  const suggestion = TripSuggestionSchema.parse({ operations: ["stay"], budgetCents: null, startsOn: null, endsOn: null, locationName: null, stayId: null, stayName: option.name, stayAddress: option.address,
    stayStartsOn: context.startsOn, stayEndsOn: context.endsOn, stayTotalCents: option.totalCents, stayBookingUrl: null, stayStatus: "planned", planId: null, planTitle: null, planStatus: null,
    planStartsOn: null, planStartsTime: null, planNote: null, planContactLabel: null });
  const proposal = buildTripChangeProposal(suggestion, context, source, [source]);
  if (!proposal) return answered("I couldn’t prepare that stay for review from the saved trip details. Nothing was saved.");
  // A new stay needs the people it covers; start from every traveler and let the organizer edit before applying.
  if (!proposal.changes.includedPersonIds.length) proposal.changes.includedPersonIds = context.travelers.map(item => item.id);
  try {
    const { intent } = await prepareLodgingIntent(slug, { researchCommandId: shortlist.commandId, optionId: option.optionId, travelerIds: proposal.changes.includedPersonIds }, options);
    if (proposal.changes.stay?.startsOn !== intent.stay.startsOn || proposal.changes.stay?.endsOn !== intent.stay.endsOn) return answered("The trip’s saved dates changed while I was preparing this. Nothing was saved; ask me again.");
    proposal.preparation = { intent, outcome: null };
  } catch (error) {
    if (error instanceof TripCoordinationError && error.code === "stale_research") return refreshed(slug, turn, options);
    if (error instanceof TripCoordinationError && error.code === "dates_required") return answered(LODGING_REPLIES.datesMissing);
    throw error;
  }
  return { assistantText: LODGING_REPLIES.prepared, sources: researchSources(shortlist.run), workspace: { tripConversation: true, tripProposal: proposal, capability: "propose_trip_change" } };
}

function refreshed(slug: string, turn: CoordinatorTurnRecord, options: CoordinationOptions) {
  return research(slug, turn, options, "The saved facts or constraints changed since that shortlist, so I researched again and did not prepare anything. ", "Tell me which option you’d like now.",
    "The saved facts or constraints changed since that shortlist, and nothing fits them now. I did not prepare anything.");
}
