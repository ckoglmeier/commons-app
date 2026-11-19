/*
 * Honesty guard for model prose. The coordinator can book nothing, pay nothing, send nothing, write to no calendar, and apply no change on its own:
 * a proposal is only a proposal until a human applies it. Any sentence of a model reply that claims (or promises) one of those things is removed by
 * code before the reply is saved or spoken, and a plain note says nothing of the kind happened. Pure so it can be tested exhaustively.
 */

import { planUpdatesOffReply } from "@/lib/coordinator-plan-proposal";

const DONE = String.raw`(?:booked|reserved|paid|charged|sent|emailed|texted|messaged|scheduled|invited|notified|posted|shared|forwarded|purchased|ordered|submitted|published|confirmed (?:it|that|this|the (?:booking|reservation|table|stay)))`;
const SAVED = String.raw`(?:shortened|lengthened|trimmed|rewritten|reworded|simplified|updated|saved|changed|applied|recorded|added|edited|revised|adjusted|approved|published|marked|moved|rescheduled|cancell?ed|switched|confirmed)`;
const WHO = String.raw`(?:i(?:'ve| have)?|we(?:'ve| have)?|commons(?: has| have)?)\s+(?:just\s+|already\s+|now\s+|successfully\s+|gone ahead and\s+)?`;

const SAVED_RECORD_CLAIM = /\b(?:activities|activity|ideas|plans?|itinerary|records?)\b[^.!?]{0,160}\b(?:were|was|are|is)\s+(?:(?:now|just|successfully|already)\s+)*(?:saved|added|recorded|created|updated)\b/i;
// A negated subject reports absence; it is not a receipt. Other action patterns still inspect the entire sentence.
const ABSENT_RECORD_REPORT = /^(?:no|not any)\s+(?:[\w-]+\s+){0,4}?(?:activities|activity|ideas|plans?|itinerary|records?)(?:\s+(?:or|and)\s+(?:decision|plan|record)s?)?\s+(?:were|was|are|is)\s+(?:saved|added|recorded|created|updated)\b/i;

const CLAIMS: RegExp[] = [
  new RegExp(String.raw`\b${WHO}created\b[^.!?]{0,70}\b(?:activities|activity|ideas|plans|records)\b`, "i"),
  // Receipts are code-written after commit. A model may not imitate one, including passive or subjectless wording.
  /^(?:(?:done|success|successfully)[,:!]?\s+)?(?:saved|added|recorded|created|updated)\b[^.!?]*\b(?:activities|activity|ideas|plans?|itinerary|records?)\b/i,
  SAVED_RECORD_CLAIM,
  new RegExp(String.raw`\b${WHO}${DONE}\b`, "i"),
  new RegExp(String.raw`\b${WHO}(?:added|put)\s+(?:it|that|this|them|the [\w -]{1,30})\s+(?:to|on)\s+(?:your|the|our)\s+(?:calendar|itinerary)\b`, "i"),
  new RegExp(String.raw`(?:\b(?:has|have|had)|'s)\s+(?:now\s+|just\s+|already\s+)?been\s+(?:successfully\s+|now\s+|just\s+)?(?:${DONE}|${SAVED})\b`, "i"),
  new RegExp(String.raw`\b(?:is|are)\s+(?:now|all set and|successfully)\s+(?:${DONE}|${SAVED}|booked|confirmed)\b`, "i"),
  new RegExp(String.raw`\b(?:got|gotten)\s+(?:it|that|this|them)\s+${DONE}\b`, "i"),
  // Promises of an action Commons cannot take.
  /\b(?:i(?:'ll| will)|i can|i(?:'m| am) going to|let me)\s+(?:go ahead and\s+)?(?:book|reserve|pay(?: for)?|charge|send|email|text|message|schedule|purchase|order|publish|post|invite|notify|call|mark|confirm|update|save|change|cancel|move|reschedule)\b/i,
  // Saved or applied changes: only a human applying a reviewed proposal, or the attendance receipt, changes anything.
  new RegExp(String.raw`\b${WHO}${SAVED}\b`, "i"),
  /\b(?:budget|trip|stay|lodging|dates?|title|draft|poll|attendance|rsvp|record)\s+(?:is|are)\s+now\b/i,
];

const NOTE = "Nothing was booked, paid, sent, scheduled, or saved by this reply.";

// ---------------------------------------------------------------------------
// Reports of bookings already saved: "We booked Synthetic Peak Lodge" is a fact, not a claim
// ---------------------------------------------------------------------------

/** Anything but a booking: a sentence that also claims one of these is never a plain report of a saved booking. */
const OTHER_ACTION = /\b(?:sent|emailed|texted|messaged|paid|charged|scheduled|invited|notified|posted|shared|forwarded|purchased|ordered|submitted|published|saved|updated|changed|applied|recorded|added|edited|revised|adjusted|approved|marked|moved|rescheduled|cancell?ed|switched)\b/i;
/** Commons as the one who acted, or an action taken for the organizer. */
const COMMONS_ACTED = /\b(?:i|i'm|i've|i'll|i'd|me|my|let me|commons)\b|\bfor you\b/i;
/** A change made just now, which only this turn could have made. */
const FRESH = /\b(?:now|just|successfully|gone ahead)\b/i;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when a sentence only reports a booking the trip already has saved: the booking verb is tied to the name of a saved booked record ("We booked
 * Synthetic Peak Lodge", "Your stay at Synthetic Peak Lodge has been booked"), Commons is not the subject, no other action is claimed, and nothing
 * says it happened just now. "We booked Alpine Table near Synthetic Peak Lodge" is not a report: the verb is tied to a new place.
 */
export function reportsSavedBooking(sentence: string, savedBookings: readonly string[]): boolean {
  const text = sentence.replace(/[’‘]/g, "'");
  if (COMMONS_ACTED.test(text) || OTHER_ACTION.test(text) || FRESH.test(text)) return false;
  return savedBookings.some(raw => {
    const name = raw.trim();
    if (name.length < 3) return false;
    const record = escape(name);
    return new RegExp(`${record}[^.!?]{0,40}\\b(?:is|was|were|has been|have been|'s been)\\s+(?:already\\s+)?(?:booked|reserved|confirmed)\\b`, "i").test(text)
      || new RegExp(`\\b(?:we|you|they|[A-Z][a-z]+)(?:'ve| have| had)?\\s+(?:already\\s+)?(?:booked|reserved|confirmed)\\s+(?:(?:the|your|our|a)\\s+)?(?:(?:stay|room|rooms|lodging|place)\\s+at\\s+)?${record}\\b`, "i").test(text);
  });
}

/** True when the text claims or promises an action Commons did not and cannot take. */
export function claimsUnperformedAction(text: string) {
  const normalized = text.replace(/[’‘]/g, "'");
  return CLAIMS.some(pattern => pattern.test(pattern === SAVED_RECORD_CLAIM ? normalized.replace(ABSENT_RECORD_REPORT, "") : normalized));
}

/**
 * Removes every sentence that claims or promises an action, and adds one plain note when anything was removed. Text with no such sentence is
 * returned unchanged. Never adds or rewrites content the model wrote beyond dropping the offending sentences.
 */
export function withoutUnperformedClaims(text: string, savedBookings: readonly string[] = []): { text: string; changed: boolean } {
  // A sentence ends at . ! or ? followed by a capital, digit or quote: "5 p.m. and sent it" stays one sentence, and so do decimals.
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])(?<!\b(?:a\.m|p\.m|e\.g|i\.e|etc|vs|St|Mr|Mrs|Ms|Dr|No))\s+(?=[A-Z0-9"“'(])/);
  const kept = sentences.filter(sentence => !claimsUnperformedAction(sentence) || reportsSavedBooking(sentence, savedBookings));
  if (kept.length === sentences.length) return { text, changed: false };
  const body = kept.join(" ").trim();
  return { text: (body ? `${body} ${NOTE}` : `${NOTE} Tell me what you’d like to do next and I’ll help from here.`).slice(0, 4000), changed: true };
}

// ---------------------------------------------------------------------------
// Artifact claims: "I drafted a question for your review" on a turn that created nothing
// ---------------------------------------------------------------------------

/** What this turn actually produced. A claim of an artifact the turn did not create is cut. */
export type CreatedArtifacts = { draft: boolean; research: boolean; tripChange: boolean; task?: boolean };

const MADE = String.raw`(?:drafted|prepared|created|set up|put together|written|wrote|made|built|started|saved|added|queued up|kicked off|launched|ran|gathered|pulled together)`;
const ARTIFACT_WHO = String.raw`(?:i(?:'ve| have)?|we(?:'ve| have)?|commons(?: has| have)?)\s+(?:just\s+|already\s+|now\s+|gone ahead and\s+)?`;
const ARTIFACT_CLAIMS: Array<{ kind: keyof CreatedArtifacts; pattern: RegExp }> = [
  // A conversation or a suggested task is not a saved task. Only code-written receipts can make that claim.
  { kind: "task", pattern: new RegExp(String.raw`\b${ARTIFACT_WHO}(?:${MADE}|assigned|completed|updated)\b[^.!?]{0,50}\b(?:task|todo|to-do)s?\b`, "i") },
  { kind: "task", pattern: /\b(?:a|the|your|this|that)\s+(?:task|todo|to-do)s?\b[^.!?]{0,40}\b(?:is|are|was|were|has been|have been)\s+(?:created|saved|added|updated|assigned|completed)\b/i },
  { kind: "tripChange", pattern: new RegExp(String.raw`\b${ARTIFACT_WHO}${MADE}\b[^.!?]{0,70}\b(?:activities|activity ideas|planned ideas|plans)\b`, "i") },
  { kind: "draft", pattern: new RegExp(String.raw`\b${ARTIFACT_WHO}(?:${MADE}|proposed)\b[^.!?]{0,50}\b(?:poll|question|survey|vote|draft|message|ballot|options?|suggested edit|itinerary|rough plan)\b`, "i") },
  { kind: "draft", pattern: /\b(?:here(?:'s| is)|below is|attached is)\s+(?:a|the|my)\s+(?:draft|poll|survey|suggested edit|(?:rough |proposed )?itinerary|rough plan)\b/i },
  { kind: "draft", pattern: /\bnothing (?:is|will be) (?:shared|sent|published)\b[^.!?]*\b(?:until|unless)\b/i },
  { kind: "tripChange", pattern: new RegExp(String.raw`\b${ARTIFACT_WHO}${MADE}\b[^.!?]{0,50}\b(?:update|proposal|change|edit)s?\b`, "i") },
  { kind: "research", pattern: new RegExp(String.raw`\b${ARTIFACT_WHO}${MADE}\b[^.!?]{0,40}\b(?:research|search|sources|results)\b`, "i") },
];
const ARTIFACT_NOTE = "I haven’t drafted, prepared or started anything with this reply.";
const POLL_OFFER = "Want me to prepare a poll for the group to review?";

// ---------------------------------------------------------------------------
// Proposal claims: "Review and apply the suggested update" on a turn that produced no review card
// ---------------------------------------------------------------------------

/**
 * A proposal or review card exists only as an artifact the turn created. Model prose that presents one as existing ("I'm including the suggestion again
 * here"), tells the organizer to act on one ("Review and apply the suggested update"), or promises one as ready ("I can prepare that status change for review")
 * is cut, and code says what is true instead.
 */
const PROPOSAL_NOUN = String.raw`(?:update|change|edit|suggestion|proposal|card|status change)s?`;
const PROPOSAL_REFERENCES: RegExp[] = [
  new RegExp(String.raw`\b(?:review|apply|approve|accept|dismiss)\b(?:\s+and\s+(?:review|apply|approve|accept))?\s+(?:the|this|that|my|our|your)\s+(?:(?:suggested|proposed|prepared|pending|above|following|updated?)\s+)*(?:review\s+)?${PROPOSAL_NOUN}\b`, "i"),
  /\b(?:review|check)\s+and\s+(?:apply|approve|accept)\s+(?:it|this|that|them)\b|\b(?:apply|approve|accept)\s+(?:it|this|that)\b[^.!?]{0,20}\bto\s+(?:mark|set|change|update|confirm|cancel|move)\b/i,
  /\b(?:i(?:'m| am)|i(?:'ve| have)?|we(?:'re| are|'ve| have)?|commons(?: is| has)?)\s+(?:just\s+|also\s+|now\s+|again\s+|still\s+)*(?:including|included|attaching|attached|adding|added|providing|provided|showing|shown|sharing|shared|giving|gave|linking|repeating|resending|re-sending|posting|posted|leaving|left|putting)\b[^.!?]{0,40}\b(?:suggestions?|suggested (?:update|change)s?|proposals?|review card|card)\b/i,
  /\b(?:here(?:'s| is)|below is|attached is|see (?:the )?(?:below|attached)|shown (?:below|above))\b[^.!?]{0,30}\b(?:suggest\w+|proposal|review card|card)\b/i,
  /\b(?:the|this|that|a)\s+(?:review\s+)?card\b[^.!?]{0,20}\b(?:below|above|is (?:ready|here|shown|saved|waiting)|on screen)\b/i,
];
// A definite promise ("that status change") reads as something ready; always cut on a turn with no proposal.
const PROPOSAL_PROMISE = /\bi can\s+(?:prepare|put together|set up|queue up|create|make)\s+(?:that|this|the|it)\b[^.!?]{0,40}\b(?:for (?:your )?review|update|change|suggestion|proposal)\b/i;
// An open offer ("I can prepare a plan update") is honest only where the capability exists.
const PROPOSAL_OFFER = /\b(?:i can|i could|i(?:'ll| will)|want me to|would you like me to|shall i|should i)\s+(?:prepare|put together|draft|queue up|create|make|set up)\s+(?:an?\s+)?(?:[\w-]+\s+){0,3}?(?:update|change|suggestion|proposal|edit)\b/i;
const PROPOSAL_FOLLOWUP = /\bnothing\s+(?:is|will be|gets)\s+(?:saved|changed|applied)\b[^.!?]*\buntil\b/i;

/** What a turn knows about trip changes, so the guard can say the truth. `planStatus`: the status the organizer asked for, when the request was about a plan. */
export type TripChangeGuard = { enabled: boolean; pending?: boolean; planStatus?: "confirmed" | "cancelled" | null };

/** True when the sentence presents a proposal or review card as existing or ready (or, where trip changes are off, offers to prepare one). */
export function refersToProposal(text: string, options: TripChangeGuard = { enabled: true }): boolean {
  const normalized = text.replace(/[’‘]/g, "'");
  if (PROPOSAL_PROMISE.test(normalized) || /\bi(?:'ll| will| am going to|'m going to)\s+(?:prepare|put together|draft|create|make|set up|queue up)\b[^.!?]{0,100}\b(?:update|change|suggestion|proposal|edit|review card)\b/i.test(normalized)) return true;
  if (!options.enabled && PROPOSAL_OFFER.test(normalized)) return true;
  return !options.pending && PROPOSAL_REFERENCES.some(pattern => pattern.test(normalized));
}

const PLANISH = /\b(?:plan|activity|status|itinerary|confirmed|cancell?ed|reschedul\w*|lesson)\b/i;
function proposalNote(options: TripChangeGuard, cut: string[]) {
  const text = cut.join(" "), planish = options.planStatus !== undefined || PLANISH.test(text);
  const status = options.planStatus ?? (/\bcancell?ed\b/i.test(text) ? "cancelled" : /\bconfirmed\b/i.test(text) ? "confirmed" : null);
  if (!options.enabled) return planish ? planUpdatesOffReply(status) : "Trip updates from chat are turned off right now. You can make the change directly on the trip. Nothing was changed.";
  return planish ? "I couldn’t prepare a plan update from that, so there is no review card and nothing was saved. Tell me which plan and which status you want to record."
    : "I couldn’t prepare a trip update from that, so there is no review card and nothing was saved. You can edit the relevant item directly in Plan.";
}

/**
 * The full honesty guard for a model reply: sentences claiming an unperformed action (booking, payment, message, calendar write, saved change) are always
 * cut, and sentences claiming a drafted, prepared, created or started artifact are cut unless this turn really produced that kind of artifact. One plain
 * note says so; when the wording had touched on asking the group (`offer: "poll"`), the coordinator offers once instead. With `tripChanges`, sentences that
 * present or promise a review card the turn did not create are cut too and replaced by what is true: trip changes are off for this trip, or the request could
 * not be prepared.
 */
/** The sentence split every guard uses: ". ! ?" followed by a capital, digit or quote. "5 p.m. and sent it" stays one sentence. */
export function splitSentences(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])(?<!\b(?:a\.m|p\.m|e\.g|i\.e|etc|vs|St|Mr|Mrs|Ms|Dr|No))\s+(?=[A-Z0-9"“'(])/);
}

export type ReplyGuardOptions = { created: Partial<CreatedArtifacts>; offer?: "poll"; tripChanges?: TripChangeGuard;
  /** Names of records the trip already has saved as booked or confirmed; a sentence that only reports one of them is kept. */
  savedBookings?: readonly string[] };

export function guardModelReply(text: string, options: ReplyGuardOptions): { text: string; changed: boolean } {
  const sentences = splitSentences(text);
  const unproduced = ARTIFACT_CLAIMS.filter(entry => !options.created[entry.kind]);
  const guard = options.tripChanges && !options.created.tripChange ? options.tripChanges : null;
  let action = false, artifact = false;
  const proposalCut: string[] = [];
  let kept = sentences.filter(sentence => {
    const normalized = sentence.replace(/[’‘]/g, "'");
    if (claimsUnperformedAction(normalized) && !reportsSavedBooking(normalized, options.savedBookings ?? [])) { action = true; return false; }
    if (guard && refersToProposal(normalized, guard)) { proposalCut.push(sentence); return false; }
    const hit = unproduced.find(entry => entry.pattern.test(normalized));
    if (hit) { if (guard && hit.kind === "tripChange") proposalCut.push(sentence); else artifact = true; return false; }
    return true;
  });
  // "Nothing is saved until you apply it" only makes sense next to the card that was just cut.
  if (proposalCut.length) kept = kept.filter(sentence => !PROPOSAL_FOLLOWUP.test(sentence.replace(/[’‘]/g, "'")));
  if (!action && !artifact && !proposalCut.length) return { text, changed: false };
  const body = kept.join(" ").trim();
  const notes = [action ? NOTE : null, artifact ? ARTIFACT_NOTE : null, proposalCut.length && guard ? proposalNote(guard, proposalCut) : null].filter(Boolean).join(" ");
  const offer = artifact && options.offer === "poll" && !/\bwant me to prepare\b/i.test(body) ? ` ${POLL_OFFER}` : "";
  return { text: `${body ? `${body} ` : ""}${notes}${offer || (body ? "" : " Tell me what you’d like to do next and I’ll help from here.")}`.slice(0, 4000), changed: true };
}

// ---------------------------------------------------------------------------
// Streaming: only what the full guard would keep may be shown before the reply is saved
// ---------------------------------------------------------------------------

/**
 * Follows a model reply as it arrives and returns the prefix that may be shown now. A sentence is released only once it is complete (the next sentence
 * has started) and the full guard, run on that sentence with the turn's own options, keeps it unchanged. "Nothing is saved until…" follow-ups are held
 * back because the full guard can still drop them. At the first sentence held back the stream freezes: nothing after it is shown until the saved reply
 * replaces the streamed text. So the streamed text is always a prefix of the saved reply, and a claim the guard cuts is never on screen, even briefly.
 */
export function replyStreamGuard(options: ReplyGuardOptions) {
  let released: string[] = [], frozen = false;
  return {
    /** Takes the whole reply so far; returns the releasable prefix, or null when nothing new can be shown. */
    next(replySoFar: string): string | null {
      if (frozen) return null;
      const complete = splitSentences(replySoFar).slice(0, -1);
      if (complete.length <= released.length) return null;
      const before = released.length;
      for (const sentence of complete.slice(before)) {
        if (!sentence || guardModelReply(sentence, options).changed || PROPOSAL_FOLLOWUP.test(sentence.replace(/[’‘]/g, "'"))) { frozen = true; break; }
        released = [...released, sentence];
      }
      return released.length > before ? released.join(" ") : null;
    },
    get frozen() { return frozen; },
  };
}
