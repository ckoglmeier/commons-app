import { coordinatorTool } from "../coordinator-tools";
import { quickRecommendationKind, quickRecommendationQuery } from "./coordinator-recommendation";
import { expenseConversionRequest } from "../coordinator-expense-request";
import { createHash } from "node:crypto";
import { venueHoursQuestion } from "./coordinator-venue-hours";
import { itineraryOperation, tripTaskOperation } from "../coordinator-artifact-intent";
import { parseOrganizerActivities, parseOrganizerInvites, reportsOwnAttendance, type CoordinatorInputMode, type RoutedIntent, type TripContextSnapshot, type TurnCommand } from "@commons/contracts";
import { isTripRecordRequest, tripRecordRequestSource } from "@/lib/coordinator-trip-proposal";
import { resolvePlanFollowUp, routesAsPlanFollowUp, type PlanThreadContext } from "@/lib/coordinator-plan-proposal";
import { provisionalTitle } from "@/lib/coordinator-turn-title";
import { buildPublicResearchQuery, isInternalLookup, isPersonContactLookup, sanitizeTypedResearchQuery, sanitizePublicLodgingQuery } from "@/lib/server/coordinator-research-query";
import { parseLinkIdea, parseThreadNavigation, parseThreadReference, resolveIdea, resolveThreadReference } from "@/lib/server/coordinator-thread-index";

/*
 * Deterministic capability routing (docs/COORDINATOR-WORKSPACE-DESIGN.md §7.1). Pure and free of server-only
 * imports so it can be tested exhaustively. The model never selects a capability: an explicit UI action wins, then
 * model-free statements, then validated parses resolved against the authorized context, and everything else is an
 * ordinary answer.
 */

export type RouteFlags = { tripChangesEnabled: boolean; researchConfigured: boolean };
export type RouteInput = {
  text: string;
  awaitingInvitationList?: boolean;
  publicLodgingQuery?: boolean;
  explicitAction?: TurnCommand["explicitAction"];
  /**
   * The organizer explicitly selected an editable Ask-the-group draft in the UI (the draft editing context). A draft the client merely attached
   * as thread context is NOT selected; the attachment alone never steers routing.
   */
  draftSelected: boolean;
  /** An editable draft is attached to the turn as thread context (not selected). It is edited only by a message that explicitly edits a named part of it. */
  draftAttached?: boolean;
  /** Server-derived from the attached saved draft, never a model/client assertion. */
  itineraryEditable?: boolean;
  /** Authorized current-thread private document, independent of its published review snapshots. */
  itineraryDocumentEditable?: boolean;
  snapshot: TripContextSnapshot;
  /** Null for legacy unthreaded contexts, where navigation, references and linking do not exist. */
  activeThreadId: string | null;
  /** The previous completed organizer message in this topic, for short trip-update follow-ups. */
  previousUserText?: string;
  /** The recent organizer messages and the title of this topic, so a follow-up that names no plan ("mark it confirmed") can be resolved from the conversation. */
  planThread?: PlanThreadContext;
  flags: RouteFlags;
  inputMode: CoordinatorInputMode;
};

const LEAD = String.raw`^(?:(?:ok(?:ay)?|hey|so|and|now|please|then|alright)[,\s]+)*(?:(?:can|could|would|will) you\s+(?:please\s+)?|go ahead and\s+|i need you to\s+|i want you to\s+|i(?:'d| would) like you to\s+|let's\s+|please\s+|you should\s+)?`;
const imperative = (verbs: string, tail = "") => new RegExp(`${LEAD}(?:${verbs})\\b${tail}`, "i");

const UNSUPPORTED_PATTERNS: Array<{ reason: Extract<RoutedIntent, { capability: "unsupported" }>["reason"]; pattern: RegExp }> = [
  { reason: "booking", pattern: imperative("book|reserve|make (?:a |the |us a )?(?:reservation|booking)") },
  { reason: "payment", pattern: imperative("pay|charge|purchase|buy|venmo|zelle|wire|put down|place (?:an|the) order|send (?:a |the )?(?:deposit|payment|money)") },
  { reason: "calendar_write", pattern: imperative("add|put|create|schedule|save|sync|block", String.raw`[^.?!]{0,60}\bcalendar\b`) },
  { reason: "calendar_write", pattern: /\bcalendar invite\b/i },
  { reason: "external_message", pattern: imperative("send|email|text|dm|notify|invite|forward|post|share", String.raw`\s+(?:this|it|that|them|everyone|the group|the travelers|all\b|a\s+(?:message|email|text|reminder|note)|an?\s+(?:invite|invitation|update)|the\s+(?:poll|link|update|plan|invite|itinerary))`) },
];

const APPROVAL = /^(?:(?:ok(?:ay)?|yes|yeah|yep|yup|sure|please|go ahead|do it|approve(?:d)?|apply|publish|confirm|accept|send it|sounds good|looks good|that works|perfect)[,.!\s]*)+(?:(?:and\s+)?(?:apply|approve|publish|confirm|save|send|do)\b\s*(?:it|that|this|those|the changes?|the update|the proposal|them)?)?[.!\s]*$/i;
// Poll preparation creates a draft, so it needs an unmistakable request: an imperative at the start of a clause ("make a poll asking...", "ask the group
// where they want to eat"). Questions ("should we ask the group?"), reports ("Robin said she'd ask the group"), plans ("I'll ask everyone later"),
// wishes and hedges never qualify; the model may offer to prepare a poll instead. Spoken requests are held to the strongest phrasings only.
// Topic words are bounded, not an allowlist of recipe names. Connectives and
// existing-object qualifiers are not names: “create a task about a poll” and
// “make the existing poll shorter” must not become new-poll requests.
const POLL_NAME_WORD = String.raw`(?!(?:about|for|on|of|to|from|with|into|using|and|or|then|that|this|these|those|existing|current|said|says|would|could|should|will)\b)[a-z0-9][a-z0-9'/-]{0,31}`;
export const POLL_NAMED_OBJECT = String.raw`(?:${POLL_NAME_WORD}\s+){0,4}(?:poll|survey|vote)\b(?!['/-])`;
const POLL_OBJECT = String.raw`(?:(?:a|an|the|another|one)\s+)?${POLL_NAMED_OBJECT}`;
const POLL_PREPARE_VERBS = "make|prepare|create|draft|start|set up|put together|write|build|spin up";
const POLL_MAKE_EDIT = imperative("make", String.raw`\s+(?:the|this|that|our|my|existing)\s+(?:(?:existing|current)\s+)?${POLL_NAMED_OBJECT}\s+(?:(?:intro|introduction|title|message|questions?|options?|wording|choices?)\s+)?(?:(?:a little|a bit|slightly|much)\s+)?(?:shorter|longer|clearer|simpler|better|warmer|friendlier|more|less|concise|anonymous|private|public|multiple|single)\b`);
const POLL_STRONG = [
  String.raw`(?:${POLL_PREPARE_VERBS})\s+(?:us\s+|me\s+)?${POLL_OBJECT}`,
  String.raw`poll\s+(?:the\s+)?(?:group|everyone|travelers|folks|people|attendees)`,
];
const POLL_WEAK = [
  String.raw`(?:help\s+me\s+)?ask\s+(?:the\s+)?(?:group|everyone|travelers|folks|the others)`,
  String.raw`get\s+(?:the\s+)?group(?:'s)?\s+(?:input|votes?|opinions?)`,
  String.raw`(?:let\s+)?(?:the\s+)?group\s+vote`,
];
const POLL_STRONG_RE = imperative(`(?:${POLL_STRONG.join("|")})`);
const POLL_WEAK_RE = imperative(`(?:${POLL_WEAK.join("|")})`);
// Any mention of asking or polling the group, in any voice: used only to decide whether the model should OFFER a poll.
const POLL_MENTION = new RegExp(`\\b(?:${[...POLL_STRONG, ...POLL_WEAK, String.raw`ask(?:ing)?\s+(?:the\s+)?(?:group|everyone|folks|the others)`].join("|")})\\b`, "i");
const POLL_FILLER = /^(?:(?:thanks|thank you|great|cool|sure|yes|yeah|yep|good|perfect|nice|awesome)[,.!\s]+)+/i;
const HEDGE = /\b(?:later|eventually|someday|maybe|perhaps|probably|might|if\s+(?:needed|necessary|we|you|it|they|she|he|i|that)|once|when we|after we|before we|instead of|rather than|not yet)\b|\b(?:don't|do not|never|no need)\b/i;

function pollClauses(text: string) {
  return text.replace(/[’‘]/g, "'").split(/[.!?;\n]+\s*|\s[—–-]\s/).map(clause => clause.trim().replace(POLL_FILLER, "")).filter(Boolean);
}

// A negative action cancels preparation only when its object is the poll/group
// ask or the just-requested “it”. “Do not create tasks” is a separate constraint.
const POLL_ACTION_REFERENCE = imperative(POLL_PREPARE_VERBS, String.raw`\s+(?:(?:it|that|this|one)(?:$|[, ]+(?:now|after all)\b)|(?:this|that|our|my|any)\s+${POLL_NAMED_OBJECT})`);
const STOP_POLL = new RegExp(String.raw`^(?:please\s+)?(?:cancel|stop)\s+(?:(?:creating|making|preparing|drafting|starting|writing|building|setting up|putting together)\s+)?(?:${POLL_OBJECT}|(?:this|that|our|my)\s+${POLL_NAMED_OBJECT}|it|that|this)\b`, "i");
function cancelsPollPreparation(clause: string) {
  const negative = clause.match(/^(?:please\s+)?(?:don't|do not|never|no need to)\s+(.+)$/i)?.[1];
  return Boolean(negative && !POLL_MAKE_EDIT.test(negative) && (POLL_STRONG_RE.test(negative) || POLL_WEAK_RE.test(negative) || POLL_ACTION_REFERENCE.test(negative))) || STOP_POLL.test(clause);
}

/** "strong" = an imperative naming a poll, survey or vote; "weak" = an imperative to ask the group; null = neither (questions, reports, plans and hedges included). */
export function pollRequestStrength(text: string): "strong" | "weak" | null {
  const value = text.trim().replace(/^[“"]([^“”"]+)[”"]$/, "$1");
  const clauses = pollClauses(value).flatMap(clause => /^(?:format|compare|summarize|list|put)\b/i.test(clause) ? clause.split(/\s+and\s+then\s+/i) : [clause]);
  // A prohibition on publication is scope, not a prohibition on preparing a
  // private draft. Negation/hedging still disqualifies the action clause itself.
  // Explicit cancellation of preparation elsewhere in the request wins.
  if (clauses.some(cancelsPollPreparation)) return null;
  if (clauses.some(clause => !HEDGE.test(clause) && !POLL_MAKE_EDIT.test(clause) && POLL_STRONG_RE.test(clause))) return "strong";
  return clauses.some(clause => !HEDGE.test(clause) && POLL_WEAK_RE.test(clause)) ? "weak" : null;
}
const RESEARCH_REQUEST = new RegExp(`${LEAD}(?:look\\s*up|research|search(?:\\s+(?:the\\s+web|online))?|google|dig up|do (?:some )?research|check online|find\\s+(?:me\\s+)?(?:some\\s+|a few\\s+|the best\\s+)?(?:options|restaurants|places|hotels|lodging|activities|ideas|spots|things to do|bars|cafes|shops))\\b`, "i");
const FACT_LOOKUP = /^(?:(?:ok(?:ay)?|hey|so|and|now|please)[,\s]+)*(?:what(?:'s| is| are| was| were)|when(?:'s| is| are| does| do)|where(?:'s| is| are)|how much|how many|which|who(?:'s| is| are)|show me|tell me|remind me|do we have|is there)\b/i;
const FACT_TOPIC = /\b(?:stay|lodging|hotel|airbnb|house|cabin|address|check-?in|check-?out|dates?|budget|cost|total|price|attending|coming|arriv\w*|depart\w*|flights?|itinerary|plans?|schedule|saved|booked|booking|confirmed)\b/i;
const ADVICE_WORDS = /\b(?:should|recommend|suggest|best|better|idea|ideas|help|options?|compare|plan for|think|prefer|worth|good)\b/i;

export type ExternalActionReason = "booking" | "payment" | "calendar_write" | "external_message";

// Words that name the action, its generic object, or filler. What remains is planning substance ("dinner", "condo", "table").
const NOT_SUBSTANCE = new Set(("the and but for with from into onto over near around about you your our their his her its them they she him who what when where which this that these those there here " +
  "can could would will let lets please just also then now ahead need want like some someone anyone everyone everybody all any group travelers people " +
  "book reserve make reservation booking pay charge purchase buy venmo zelle wire put place order send deposit payment money message messages email emails text texts notify invite invitation forward post share " +
  "add create schedule save sync block calendar google apple outlook reminder note update plan").split(" "));
const contentWords = (text: string) => text.toLowerCase().replace(/'s\b/g, "").split(/[^a-z]+/).filter(word => word.length >= 3 && !NOT_SUBSTANCE.has(word));

/**
 * An external-action request (booking, payment, calendar write, sending a message), or null. Requests are matched
 * per clause, so "we're driving from Denver; book us somewhere for dinner" counts; reports and questions ("we booked
 * it", "should we book early?") never do. `substantive` = the message also carries something to plan (two or more
 * content words), in which case the coordinator answers that need after stating the limit; a bare request is only refused.
 */
export function externalActionRequest(rawText: string): { reason: ExternalActionReason; substantive: boolean } | null {
  const text = rawText.trim().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
  if (text.length > 400 || /^(?:should|how|what|why|when|where|which|who|is|are|do|does|did|will|would)\b/i.test(text) && text.includes("?")) return null;
  const clauses = text.split(/(?:[;.!?]+|,|\s[—–-]\s|\s+(?:and|then|so|but|also)\s+)\s*/i).map(clause => clause.trim()).filter(Boolean);
  for (const clause of clauses) {
    const hit = UNSUPPORTED_PATTERNS.find(entry => entry.pattern.test(clause));
    if (hit) return { reason: hit.reason as ExternalActionReason, substantive: contentWords(text).length >= 2 };
  }
  return null;
}

/** Which external action a message asks for, bare or not, or null. */
export function unsupportedReasonFor(rawText: string): ExternalActionReason | null {
  return externalActionRequest(rawText)?.reason ?? null;
}

/** An explicit, imperative request to prepare a poll or ask the group. Typed text accepts both phrasings; a spoken request only the strong one (see `routeCoordinatorIntent`). */
export function isExplicitPollRequest(text: string, inputMode: CoordinatorInputMode = "text") {
  const strength = pollRequestStrength(text);
  return strength === "strong" || strength === "weak" && inputMode !== "voice";
}
/** True when the wording mentions asking or polling the group but is not an explicit request (a question, a report, a plan, a hedge, or a spoken weak phrasing). */
export function mightWantPoll(text: string, inputMode: CoordinatorInputMode = "text") {
  return !isExplicitPollRequest(text, inputMode) && POLL_MENTION.test(text) && !/\b(?:don't|do not|never|no need)\b/i.test(text);
}
export function isExplicitResearchRequest(text: string) { return text.trim().length <= 600 && RESEARCH_REQUEST.test(text.trim().replace(/[’‘]/g, "'")) && !/\bpoll\b/i.test(text) && !HEDGE.test(text); }

// Edits to the draft the organizer has selected: an imperative editing verb, or a statement about a named part of the draft.
const DRAFT_EDIT = imperative("change|edit|update|rewrite|reword|rephrase|revise|tweak|adjust|fix|shorten|lengthen|simplify|expand|trim|cut|add|remove|delete|drop|replace|swap|rename|reorder|move|include|exclude|make|set|use|turn|put|insert|clarify|soften|tighten|polish|improve|rework|redo|combine|split|keep");
const DRAFT_PART = /^(?:the\s+)?(?:title|intro(?:duction)?|heading|message|question|options?|answers?|choices?|wording|tone|description|note)\b[^?]*\b(?:should|needs? to|must|could)\b/i;
/** With a draft explicitly selected, only edit-like messages edit it. Questions, research and lookups route normally. */
export function isDraftEditRequest(text: string) {
  const value = text.trim().replace(/[’‘]/g, "'");
  const clauses = value.split(/[.!;\n]+\s*/).map(clause => clause.trim()).filter(Boolean);
  return !/^(?:how|what|why|when|where|which|who|is|are|do|does|did|should)\b/i.test(value) && clauses.some(clause => DRAFT_EDIT.test(clause) || DRAFT_PART.test(clause) && !clause.includes("?"));
}
export function isItineraryEditRequest(text: string) {
  const value = text.trim().replace(/[’‘]/g, "'");
  // Changing trip records remains a separate capability. The itinerary is not authority over dates, budgets or lodging.
  if (isTripRecordRequest(value) && !/\b(?:itinerary|draft)\b/i.test(value)) return false;
  return isDraftEditRequest(value) || imperative("build|compose|draft|plan|put together", String.raw`[^.?!]{0,60}\b(?:itinerary|rough plan|schedule|weekend|trip)\b`).test(value);
}
// A draft that is only attached as thread context is edited by a message that unmistakably edits it: a plain editing verb AND a named part of the draft.
const ATTACHED_EDIT = imperative("change|edit|update|rewrite|reword|rephrase|revise|tweak|adjust|shorten|lengthen|simplify|rename|reorder|remove|delete|add|replace|swap|make");
const DRAFT_NOUN = /\b(?:draft|poll|survey|title|intro(?:duction)?|heading|message|questions?|options?|answers?|choices?|wording|tone|description)\b/i;
export function isExplicitAttachedDraftEdit(text: string) {
  const value = text.trim().replace(/[’‘]/g, "'");
  if (/^(?:how|what|why|when|where|which|who|is|are|do|does|did|should)\b/i.test(value)) return false;
  return value.split(/[.!;\n]+\s*/).map(clause => clause.trim()).filter(Boolean).some(clause => ATTACHED_EDIT.test(clause) && DRAFT_NOUN.test(clause) && !HEDGE.test(clause));
}
export function isFactLookup(text: string) {
  const value = text.trim();
  return value.length <= 200 && FACT_LOOKUP.test(value) && FACT_TOPIC.test(value) && !ADVICE_WORDS.test(value);
}

/**
 * Requests Commons answers without a model call (attendance statement, thread navigation, linking an idea, an
 * unsupported verb). Text-only, so it can run before anything is saved; the full router may still narrow it.
 */
export function isModelFreeRequest(text: string, explicitAction: TurnCommand["explicitAction"] | undefined, threaded: boolean, artifactTasksEnabled = false) {
  // Choosing which task a correction applies to is answered from the database alone.
  if (explicitAction?.kind === "task_control") return true;
  if (explicitAction) return false;
  if (coordinatorTool(text)?.kind === "add") return true;
  if (threaded && artifactTasksEnabled && tripTaskOperation(text) && !externalActionRequest(text)) return true;
  if (reportsOwnAttendance(text) || parseOrganizerInvites(text) || parseOrganizerActivities(text) || expenseConversionRequest(text)) return true;
  if (threaded) {
    const navigation = parseThreadNavigation(text);
    // A tentative phrase ("switch to lodging") may turn out to be ordinary conversation, which does need the model.
    if (navigation && !(navigation.kind === "navigate" && navigation.tentative) || parseLinkIdea(text)) return true;
  }
  // A bare external request is refused without a model; one that also carries something to plan is answered (with the limit stated first).
  const external = externalActionRequest(text);
  return external !== null && !external.substantive;
}

function pendingInThread(snapshot: TripContextSnapshot, threadId: string | null) {
  return snapshot.pendingProposals.some(proposal => proposal.value.threadId === threadId);
}

/**
 * Deterministic, ordered routing (design §7.1). The model never selects a capability; an explicit UI action wins,
 * then model-free statements, then validated parses, and everything else is an ordinary answer.
 */
export function routeCoordinatorIntent(input: RouteInput): RoutedIntent {
  const { text, explicitAction, snapshot, activeThreadId } = input, threaded = activeThreadId !== null;
  if (explicitAction?.kind === "ask_group") return { capability: "prepare_poll", starterId: explicitAction.starterId };
  if (explicitAction?.kind === "research") {
    const options = { reviewedFoodSearch: input.inputMode === "text" };
    const query = input.publicLodgingQuery ? sanitizePublicLodgingQuery(explicitAction.query, snapshot, options) : sanitizeTypedResearchQuery(explicitAction.query, snapshot, options);
    return query ? { capability: "research", query: query.query, querySource: "organizer_typed" } : { capability: "unsupported", reason: "research_query_unsafe" };
  }
  if (parseOrganizerInvites(text, input.awaitingInvitationList)) return { capability: "invite_people" };
  if (!explicitAction && parseOrganizerActivities(text)) return { capability: "add_activities" };
  if (!explicitAction && expenseConversionRequest(text)) return { capability: "prepare_expense" };
  if (reportsOwnAttendance(text)) return { capability: "record_attendance" };

  if (threaded) {
    const navigation = parseThreadNavigation(text);
    if (navigation?.kind === "unsupported") return { capability: "unsupported", reason: navigation.reason };
    if (navigation?.kind === "navigate") {
      if (navigation.action === "start_separate") return { capability: "navigate_thread", action: "start_separate", targetThreadId: null, candidateThreadIds: [], title: navigation.target ? provisionalTitle(navigation.target) : null };
      // Only an explicit thread word may lead to "I couldn't find that thread"; every other phrasing navigates only when the whole phrase names an existing thread.
      const resolved = resolveThreadReference(navigation.target ?? "", snapshot.threads, { activeThreadId, includeActive: true, strict: navigation.tentative });
      if (resolved.kind === "unique") return { capability: "navigate_thread", action: navigation.action, targetThreadId: resolved.threadId, candidateThreadIds: [], title: null };
      if (resolved.kind === "ambiguous") return { capability: "navigate_thread", action: navigation.action, targetThreadId: null, candidateThreadIds: resolved.threadIds, title: null };
      if (!navigation.tentative) return { capability: "navigate_thread", action: navigation.action, targetThreadId: null, candidateThreadIds: [], title: navigation.target ? provisionalTitle(navigation.target) : null };
    }
    const idea = parseLinkIdea(text);
    if (idea) {
      const resolved = resolveIdea(idea, snapshot.plans.map(plan => ({ itemId: plan.value.itemId, title: plan.value.title })));
      return resolved.kind === "unique" ? { capability: "link_idea", itineraryItemId: resolved.itemId, candidateItemIds: [] }
        : { capability: "link_idea", itineraryItemId: null, candidateItemIds: resolved.kind === "ambiguous" ? resolved.itemIds : [] };
    }
  }

  const external = externalActionRequest(text);
  if (external) return external.substantive ? { capability: "answer", limitNotice: external.reason } : { capability: "unsupported", reason: external.reason };
  if (APPROVAL.test(text.trim()) && pendingInThread(snapshot, activeThreadId)) return { capability: "unsupported", reason: input.inputMode === "voice" ? "voice_approval" : "approval_in_chat" };
  if (input.itineraryDocumentEditable && itineraryOperation(text, true) && isItineraryEditRequest(text)) return { capability: "research", query: "Assemble itinerary from saved context", querySource: "organizer_typed" };
  if (input.itineraryEditable && isItineraryEditRequest(text)) return { capability: "prepare_poll", starterId: null };

  // A confirmation, cancellation or time change reported about a saved plan is a plan update to review; with an editable draft selected it is draft wording instead.
  const savedPlans = input.draftSelected ? undefined : snapshot.plans.map(plan => ({ id: plan.value.itemId, title: plan.value.title, status: plan.value.status }));
  if (!input.flags.tripChangesEnabled && savedPlans && input.planThread) {
    // Asking for a plan update where trip changes are off is answered by code, once and plainly; the model is never asked to describe a capability that is not there.
    const followUp = resolvePlanFollowUp(text, savedPlans, input.planThread);
    if (routesAsPlanFollowUp(followUp)) return { capability: "unsupported", reason: "plan_updates_off", planStatus: followUp.request.status ?? (followUp.kind === "unique" ? followUp.status : null) };
  }
  if (input.flags.tripChangesEnabled && tripRecordRequestSource(text, input.previousUserText, savedPlans, input.planThread)) return { capability: "propose_trip_change", requestText: text };
  if (threaded) {
    // Another conversation's content is read from Commons, never searched for and never mistaken for a draft edit: this comes before both.
    const reference = parseThreadReference(text);
    if (reference) {
      const resolved = resolveThreadReference(reference, snapshot.threads, { activeThreadId, includeActive: false });
      if (resolved.kind === "unique") return { capability: "retrieve_context", threadIds: [resolved.threadId], ambiguousThreadIds: [] };
      if (resolved.kind === "ambiguous") return { capability: "retrieve_context", threadIds: [], ambiguousThreadIds: resolved.threadIds };
    }
  }
  // Only a draft the organizer selected is edited by an edit-like request; a draft merely attached as thread context only by a message that explicitly edits a named
  // part of it. Poll preparation from text needs an explicit imperative request.
  if (input.draftSelected && isDraftEditRequest(text)) return { capability: "prepare_poll", starterId: null };
  if (input.draftAttached && isExplicitAttachedDraftEdit(text)) return { capability: "prepare_poll", starterId: null };
  if (threaded && isExplicitPollRequest(text, input.inputMode)) return { capability: "prepare_poll", starterId: null };

  if (quickRecommendationKind(text)) {
    const query = quickRecommendationQuery(text,snapshot);
    return query ? {capability:"research",query,querySource:"sanitized_from_request"} : {capability:"unsupported",reason:"research_query_unsafe"};
  }
  const hours = venueHoursQuestion(text, input.previousUserText);
  if (hours) {
    if (isPersonContactLookup(hours, snapshot)) return { capability: "unsupported", reason: "research_contact_lookup" };
    if (isInternalLookup(hours, snapshot)) return { capability: "retrieve_context", threadIds: [], ambiguousThreadIds: [] };
    const query = buildPublicResearchQuery(hours, snapshot);
    return query ? { capability: "research", query, querySource: "sanitized_from_request" } : { capability: "unsupported", reason: "research_query_unsafe" };
  }
  const research = input.flags.researchConfigured && isExplicitResearchRequest(text);
  if (research) {
    // The public web only ever sees a request about the public world. Contact details of a person are never looked up, and questions about the
    // organizers' own discussion, plans or travelers are answered from Commons.
    if (isPersonContactLookup(text, snapshot)) return { capability: "unsupported", reason: "research_contact_lookup" };
    if (isInternalLookup(text, snapshot)) return { capability: "retrieve_context", threadIds: [], ambiguousThreadIds: [] };
    const query = buildPublicResearchQuery(text, snapshot);
    return query ? { capability: "research", query, querySource: "sanitized_from_request" } : { capability: "unsupported", reason: "research_query_unsafe" };
  }

  if (isFactLookup(text) && !isTripRecordRequest(text)) return { capability: "retrieve_context", threadIds: [], ambiguousThreadIds: [] };
  return threaded && mightWantPoll(text, input.inputMode) ? { capability: "answer", offer: "poll" } : { capability: "answer" };
}

/** A short, listenable version of the durable answer: at most three sentences and 600 characters. */
export function spokenSummary(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  // A sentence ends at ., ! or ? followed by a space: "$1,840.00" and "4.5 stars" stay whole.
  const sentences = normalized.split(/(?<=[.!?])\s+/);
  let spoken = "";
  for (const sentence of sentences.slice(0, 3)) {
    const next = spoken ? `${spoken} ${sentence}` : sentence;
    if (next.length > 600) break;
    spoken = next;
  }
  return (spoken || normalized.slice(0, 597) + (normalized.length > 597 ? "…" : "")).trim();
}

/** The seed for ids derived from a command: scoped to the trip and the organizer, so a command id reused in another trip or by another organizer derives different ids. */
export function derivedIdSeed(tripId: string, actorId: string, commandId: string) { return `${tripId}:${actorId}:${commandId}`; }

/** A stable uuid derived from the command, so a retried command never creates a second thread or draft under another id. */
export function derivedUuid(commandId: string, label: string) {
  const bytes = createHash("sha256").update(`${commandId}:${label}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
