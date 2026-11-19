import type { CoordinatorThread } from "@commons/contracts";
import { isExplicitPollRequest, POLL_NAMED_OBJECT } from "./coordinator-routing";

type PollResolution = { request: string; savedDraftId?: string };
export function isPollRediscovery(text:string,turns:CoordinatorThread["turns"],currentTurnId?:string) {
  const value=text.trim().replace(/[’‘]/g,"'");
  if(/^(?:where(?: is|'s) (?:that|the|my) poll|show the poll to me|show me the poll)[.!?]*$/i.test(value)) return true;
  if(!/^(?:show it to me|show me it)[.!?]*$/i.test(value)) return false;
  const prior=turns.filter(turn=>turn.id!==currentTurnId).at(-1);
  return Boolean(prior && (!prior.status || prior.status==="completed") && !prior.workspace?.itineraryDraft && !prior.workspace?.tripProposal && (prior.workspace?.pollDiscovery?.length || prior.workspace?.pollReview || prior.workspace?.pollOffer || prior.workspace?.capability==="prepare_poll"&&prior.draftId));
}
const LEAD = /^(?:(?:ok(?:ay)?|now|please|yes|go ahead and)[,\s]+)*(?:(?:can|could|would) you\s+(?:please\s+)?)?/i;
function followUp(text: string) {
  const value = text.trim().replace(/[’‘]/g, "'").replace(LEAD, "");
  // Only explicit private preparation/recovery, with bounded scope-only tails.
  // A bare yes, publication, quoted prose and another topic never grant intent.
  return new RegExp(String.raw`^(?:prepare|create|make|draft)\s+(?:it|that|this|(?:the|that|this)\s+${POLL_NAMED_OBJECT})(?:\s+now)?(?:[, ]+(?:using (?:the|those) (?:two )?options (?:I|we) just (?:provided|gave)|with (?:the|those) (?:same |two )?(?:options|choices)|for (?:my|our) review))?(?:[.!]\s*(?:keep it private|keep it in this conversation|do not (?:publish|share|send)(?: it)?))*[.!]?$`, "i").test(value)
    || /^you were supposed to draft it[,— -]*(?:where is|where's) that\??$/i.test(value);
}
function followUpTopic(text: string) {
  const value=text.trim().replace(/[’‘]/g,"'").replace(LEAD,"");
  const named=value.match(new RegExp(String.raw`^(?:prepare|create|make|draft)\s+(?:the|that|this)\s+(${POLL_NAMED_OBJECT})`,"i"))?.[1];
  return (named?.replace(/\s*(?:poll|survey|vote)$/i,"").toLowerCase().split(/\s+/) ?? []).filter(word=>word && !["new","private","quick","simple","group"].includes(word));
}
function namesHumanRequest(text: string, topic: string[]) {
  if (!topic.length) return true;
  if (followUp(text)) {
    const priorTopic = followUpTopic(text);
    return priorTopic.length > 0 && topic.every(word => priorTopic.includes(word));
  }
  const clauses=text.replace(/[’‘]/g,"'").split(/[.!?;\n]+\s*/);
  return clauses.some(clause=>isExplicitPollRequest(clause,"text") && topic.every(word=>clause.toLowerCase().split(/\b(?:poll|survey|vote)\b/)[0].split(/\s+/).includes(word)));
}
function recoveryBridge(text: string) {
  return followUp(text) || /^(?:just that one|did you (?:make|create|save|prepare) it\??|where(?: is|'s) (?:that|the) poll\??|you were supposed to draft it.*)$/i.test(text.trim().replace(/[’‘]/g, "'"));
}

/** Human-only, same-author/conversation recovery. Saved receipts are reused,
 * never treated as permission to create a second artifact. */
export function resolvePollPreparation(text: string, turns: CoordinatorThread["turns"], currentTurnId?: string, selectedDraftId?: string): PollResolution | null {
  const normalized = text.trim().replace(/[’‘]/g, "'");
  const review = isPollRediscovery(text,turns,currentTurnId);
  const assent = /^(?:yes|yes,? please|sure|go ahead|yes,? do it)[.!]*$/i.test(normalized);
  const prior = turns.filter(turn => turn.id !== currentTurnId).at(-1);
  const current = turns.find(turn => turn.id === currentTurnId);
  if (assent && prior && (!current || prior.threadId === current.threadId && prior.authorPersonId === current.authorPersonId) && (!prior.status || prior.status === "completed")) {
    const offer = prior.workspace?.pollOffer;
    if (offer && new Date(offer.expiresAt).getTime() > Date.now() && !prior.workspace?.tripProposal && !prior.workspace?.proposal && !prior.workspace?.itineraryDraft) return { request: offer.request };
    // Recovery for a pre-offer release: explicit human request plus one clear
    // preparation offer, in the immediately preceding same-author turn only.
    if (!offer && isExplicitPollRequest(prior.userText, "text") && /(?:want me to|shall I|would you like me to|I can) (?:prepare|create|make|draft) (?:a |the )?poll/i.test(prior.assistantText) && !prior.workspace?.tripProposal && !prior.workspace?.proposal && !/\b(?:plan update|trip update|publish|send|book)\b/i.test(prior.assistantText) && (!prior.createdAt || Date.now() - new Date(prior.createdAt).getTime() < 600_000)) return { request: prior.userText };
    return null;
  }
  if (review) {
    const activeThread = current?.threadId ?? prior?.threadId;
    const receipt = [...turns].reverse().find(turn => turn.id !== currentTurnId && turn.threadId === activeThread && (!turn.status || turn.status === "completed") && (turn.workspace?.pollReview || turn.workspace?.capability === "prepare_poll" && turn.draftId && !turn.workspace?.proposal && !turn.workspace?.tripConversation));
    const savedDraftId = receipt?.workspace?.pollReview?.draftId ?? receipt?.draftId;
    return savedDraftId ? {request: text, savedDraftId} : null;
  }
  if (!followUp(text)) return isExplicitPollRequest(text, "text") ? { request: text } : null;
  const topic=followUpTopic(text);
  const threadId = current?.threadId ?? turns.at(-1)?.threadId;
  const authorId = current?.authorPersonId ?? turns.at(-1)?.authorPersonId;
  const recent = turns.filter(turn => turn.id !== currentTurnId && (!current?.createdAt || !turn.createdAt || new Date(turn.createdAt) <= new Date(current.createdAt))).slice(-6);
  for (let i = recent.length - 1; i >= 0; i--) {
    const turn = recent[i];
    if (turn.threadId !== threadId || turn.authorPersonId !== authorId || turn.status && !["completed", "failed"].includes(turn.status)) return null;
    if (turn.workspace?.proposal || turn.workspace?.itineraryDraft) return null;
    // A clarification retains the selected artifact as context, not a creation
    // receipt. New construction uses prepare_poll without tripConversation.
    const receipt=turn.workspace?.pollReview?.draftId ?? (turn.workspace?.capability === "prepare_poll" && !turn.workspace.tripConversation ? turn.draftId : null);
    if (receipt) {
      if (!namesHumanRequest(turn.userText,topic) || !topic.length && selectedDraftId && selectedDraftId!==receipt) return null;
      return turn.workspace?.pollReview || isExplicitPollRequest(turn.userText,"text") ? { request: [turn.userText, text].join("\n"), savedDraftId: receipt } : null;
    }
    if (isExplicitPollRequest(turn.userText, "text")) return namesHumanRequest(turn.userText,topic) ? { request: [turn.userText, ...recent.slice(i + 1).map(item => item.userText), text].join("\n") } : null;
    if (!recoveryBridge(turn.userText)) return null;
  }
  return null;
}
export function pollPreparationRequest(text: string, turns: CoordinatorThread["turns"], currentTurnId?: string): string | null {
  const resolved = resolvePollPreparation(text, turns, currentTurnId);
  return resolved && !resolved.savedDraftId ? resolved.request : null;
}
