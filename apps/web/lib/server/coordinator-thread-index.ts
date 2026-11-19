import type { ThreadIndexEntry } from "@commons/contracts";

/*
 * Pure, deterministic thread-reference logic (design §7.3). Navigation and cross-thread
 * references are resolved from the authorized thread index by text overlap, never by the
 * model, so a target is chosen only when it is unambiguous and never arbitrarily.
 */

const STOPWORDS = new Set(["the", "a", "an", "of", "for", "our", "my", "we", "us", "you", "i", "this", "that", "these", "those", "thread", "threads", "conversation", "conversations", "topic", "topics", "chat", "discussion",
  "option", "options", "idea", "ideas", "list", "shortlist", "suggestion", "suggestions", "pick", "picks", "one", "ones", "about", "on", "in", "to", "and", "or", "with", "from", "up", "please", "other", "new", "separate"]);

/** Small fixed synonym classes for the trip's common topics. A class match scores below an exact word match. */
const CLASSES: string[][] = [
  ["dinner", "lunch", "breakfast", "brunch", "restaurant", "eat", "eating", "food", "meal", "dining", "cafe", "reservation"],
  ["lodging", "stay", "hotel", "airbnb", "house", "cabin", "accommodation", "condo", "lodge", "vrbo", "room", "place"],
  ["travel", "flight", "drive", "driving", "car", "transport", "transportation", "airport", "shuttle", "train", "route", "arrival", "departure"],
  ["budget", "cost", "price", "expense", "spending", "money", "split"],
  ["activity", "ski", "skiing", "lesson", "hike", "hiking", "excursion", "adventure", "tour"],
];
const CLASS_OF = new Map<string, number>(CLASSES.flatMap((words, index) => words.map(word => [word, index] as const)));

function singular(word: string) {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function topicTokens(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[’']s\b/g, "").split(/[^a-z0-9]+/).filter(Boolean).map(singular).filter(word => word.length > 1 && !STOPWORDS.has(word)))];
}

function score(query: string[], entry: ThreadIndexEntry) {
  const title = topicTokens(entry.title), summary = new Set(topicTokens(entry.summary ?? ""));
  let total = 0, fromTitle = 0;
  for (const word of query) {
    let best = 0;
    for (const candidate of title) {
      if (candidate === word) best = Math.max(best, 3);
      else if (CLASS_OF.has(word) && CLASS_OF.get(word) === CLASS_OF.get(candidate)) best = Math.max(best, 2);
    }
    fromTitle += best;
    total += best + (summary.has(word) ? 1 : 0);
  }
  // The summary can strengthen a match but never create one: a thread is chosen because its title says so.
  return fromTitle >= 2 ? total : 0;
}

export type ThreadResolution = { kind: "none" } | { kind: "unique"; threadId: string } | { kind: "ambiguous"; threadIds: string[] };

/**
 * Best unambiguous thread for a topic phrase. Unique = best score >= 2 and at least twice the runner-up (or the
 * only exact title match). Archived threads are candidates only when named exactly. Never picks between equals.
 */
export function resolveThreadReference(phrase: string, threads: ThreadIndexEntry[], options: { activeThreadId?: string | null; includeActive?: boolean; /** Every word of the phrase must be matched by the thread's title (exactly or by topic class); used when the phrase is not explicit navigation ("switch to dinner at 6" is not a thread name). */ strict?: boolean } = {}): ThreadResolution {
  const query = topicTokens(phrase);
  if (!query.length) return { kind: "none" };
  const normalized = query.join(" ");
  const exact = threads.filter(entry => topicTokens(entry.title).join(" ") === normalized);
  const pool = threads.filter(entry => (options.includeActive !== false || entry.threadId !== options.activeThreadId) && (entry.status === "active" || exact.some(match => match.threadId === entry.threadId)));
  const exactInPool = pool.filter(entry => exact.some(match => match.threadId === entry.threadId));
  if (exactInPool.length === 1) return { kind: "unique", threadId: exactInPool[0].threadId };
  const covers = (entry: ThreadIndexEntry) => {
    const title = topicTokens(entry.title);
    return query.every(word => title.some(candidate => candidate === word || (CLASS_OF.has(word) && CLASS_OF.get(word) === CLASS_OF.get(candidate))));
  };
  const scored = pool.filter(entry => !options.strict || covers(entry)).map(entry => ({ entry, value: score(query, entry) })).filter(item => item.value >= 2).sort((a, b) => b.value - a.value);
  if (!scored.length) return { kind: "none" };
  if (scored.length === 1 || scored[0].value >= scored[1].value * 2) return { kind: "unique", threadId: scored[0].entry.threadId };
  return { kind: "ambiguous", threadIds: scored.filter(item => item.value * 2 >= scored[0].value).slice(0, 4).map(item => item.entry.threadId) };
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export type NavigationParse =
  | { kind: "navigate"; action: "open" | "continue_in" | "start_separate"; target: string | null; /** Only navigate if the target resolves; otherwise treat as ordinary conversation. */ tentative: boolean; moveWording: boolean }
  | { kind: "unsupported"; reason: "thread_merge_or_split" | "move_messages" };

const PREFIX = /^(?:(?:ok(?:ay)?|hey|so|and|now|please|then)[,\s]+)*(?:(?:can|could|would) you\s+|let['’]?s\s+|i(?:['’]d| would) like to\s+|i want to\s+|i(?:['’]d| would) like you to\s+)?(?:please\s+)?/i;
const THREAD_WORD = String.raw`(?:thread|conversation|topic|chat)`;

function cleanTarget(value: string | undefined) {
  const cleaned = (value ?? "").replace(new RegExp(String.raw`\b${THREAD_WORD}s?\b`, "gi"), "").replace(/^(?:the|a|an|our|my)\s+/i, "").replace(/[\s.,;:!?]+$/g, "").replace(/\s+/g, " ").trim();
  return cleaned && !/^(?:this|that|it|this one|that one|here)$/i.test(cleaned) ? cleaned.slice(0, 80) : null;
}

export function parseThreadNavigation(rawText: string): NavigationParse | null {
  // A spoken request arrives with sentence punctuation ("Open the lodging thread."); a typed one may too.
  const text = rawText.trim().replace(/[’‘]/g, "'").replace(/\s+/g, " ").replace(/[.!]+$/, "");
  if (text.length > 240 || text.includes("?") && /^(?:how|what|why|when|where|which|who|is|are|do|does|did)\b/i.test(text)) return null;
  const body = text.replace(PREFIX, "");
  if (/\b(?:merge|combine|consolidate|join)\b[^.]*\b(?:threads?|conversations?|topics?)\b/i.test(body) || /\bsplit\b[^.]*\b(?:this|the|that)?\s*(?:threads?|conversations?|topics?)\b/i.test(body)) return { kind: "unsupported", reason: "thread_merge_or_split" };
  if (/\b(?:move|copy|transfer)\s+(?:(?:all|the|these|those|my|our)\s+)*(?:(?:earlier|previous|old|existing)\s+)?(?:messages?|polls?|drafts?|proposals?|research|ideas?|artifacts?|history|discussion|notes?|everything)\b/i.test(body)
    || /\bmove\s+(?:it|them)\s+all\b/i.test(body)) return { kind: "unsupported", reason: "move_messages" };

  const separate = /^(?:start|open|create|begin|make|spin up)\s+(?:a\s+|another\s+|one\s+)?(?:(?:separate|new|different|fresh|second)\s+)(?:thread|conversation|topic|chat)\b(?:\s+(?:for|about|on|called|named|to talk about)\s+(.+))?$/i.exec(body)
    ?? /^(?:take|put|do|handle|keep)\s+(?:this|that|it)\s+(?:in|to|into|on)\s+(?:a\s+)?(?:separate|new|different)\s+(?:thread|conversation|topic|chat)\b(?:\s+(?:for|about|on)\s+(.+))?$/i.exec(body);
  if (separate) return { kind: "navigate", action: "start_separate", target: cleanTarget(separate[1]), tentative: false, moveWording: false };

  // Navigation needs an explicit word for it. A thread word (thread / topic / conversation / chat) makes the request explicit; without one, only
  // "continue this in X", "move to X", "open X" and "switch to X" count, and only when X names an existing thread. "Go to the airport by 3" and
  // "let's go to dinner at 6" are ordinary conversation, whatever threads exist.
  const cont = /^(?:continue|carry on|carry|pick up|take|move|keep going|put)\s+(?:this|that|it|the conversation|our conversation|this conversation)?\s*(?:conversation\s+)?(?:in|to|into|over to|on)\s+(?:the\s+|our\s+)?(.+?)$/i.exec(body);
  if (cont && !/^(?:a|another)\s+(?:separate|new|different)\b/i.test(cont[1])) {
    const target = cleanTarget(cont[1]);
    const named = new RegExp(String.raw`\b${THREAD_WORD}\b`, "i").test(cont[1]);
    // "Take this to the airport" or "put it in the fridge" needs "this/that/it" and a matching thread; a bare "move to X" needs the thread word.
    const hasObject = /^(?:continue|carry on|carry|pick up|take|move|keep going|put)\s+(?:this|that|it|the conversation|our conversation|this conversation)\b/i.test(body);
    if (target && (named || hasObject || /^(?:continue|carry on)\b/i.test(body) && target.split(" ").length <= 3)) return { kind: "navigate", action: "continue_in", target, tentative: !named, moveWording: /^(?:move|take|put)\b/i.test(body) };
  }
  const strictOpen = /^(?:open|go to|switch to|jump to|take me to|head to|bring up|pull up|show me|back to|return to)\s+(?:the\s+|our\s+)?(.+?)\s+(?:thread|conversation|topic|chat)$/i.exec(body);
  if (strictOpen) {
    const target = cleanTarget(strictOpen[1]);
    if (target) return { kind: "navigate", action: "open", target, tentative: false, moveWording: false };
  }
  const looseOpen = /^(?:open|switch to)\s+(?:the\s+|our\s+)?(.+)$/i.exec(body);
  const looseTarget = cleanTarget(looseOpen?.[1]);
  if (looseTarget && looseTarget.split(" ").length <= 3) return { kind: "navigate", action: "open", target: looseTarget, tentative: true, moveWording: false };
  return null;
}

/**
 * A reference to another conversation's content ("use the dinner options we discussed", "from the lodging thread").
 * Returns the topic phrase to resolve, or null when the message is not such a reference.
 */
export function parseThreadReference(rawText: string): string | null {
  const text = rawText.trim().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
  if (text.length > 400) return null;
  const said = String.raw`(?:discussed|talked about|looked at|listed|went over|covered|mentioned|came up with|found|saved|shortlisted|drafted|liked|considered|said|decided|settled on|landed on|chose|picked)`;
  const patterns = [
    new RegExp(String.raw`\b(?:in|from|on|see|check|read|look at|based on|using|use)\s+(?:the|that|our|those|this)\s+(.+?)\s+${THREAD_WORD}\b`, "i"),
    new RegExp(String.raw`\b(?:use|reuse|go with|pick from|choose from|start from|build on|based on|from|pull from|take)\s+(?:the|those|that|our|these)\s+(.+?)\s+(?:that\s+)?(?:we|you|i)\s+${said}\b`, "i"),
    new RegExp(String.raw`\b(?:the|those|that|our)\s+(.+?)\s+(?:options|ideas|list|shortlist|suggestions|picks|candidates|recommendations|plan)\s+(?:we|you|i)\s+${said}\b`, "i"),
    new RegExp(String.raw`\bwhat\s+(?:did|have)\s+we\s+(?:say|decide|discuss|talk about|land on|settle on|pick|choose|conclude)\s+(?:about|for|on|in|regarding|with)\s+(?:the\s+|our\s+)?(.+?)[?.!]*$`, "i"),
  ];
  for (const pattern of patterns) {
    const phrase = pattern.exec(text)?.[1];
    if (phrase && topicTokens(phrase).length) return phrase;
  }
  return null;
}

/** "link the ski lesson idea to this thread" -> "ski lesson". */
export function parseLinkIdea(rawText: string): string | null {
  const text = rawText.trim().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
  if (text.length > 240 || /^(?:how|what|why|when|where|which|who|is|are|do|does|did)\b/i.test(text)) return null;
  const match = /^(?:(?:please|can you|could you|let's)\s+)*(?:link|attach|tie|connect|pin)\s+(?:the\s+|our\s+|my\s+)?(.+?)\s+(?:idea|plan|activity|suggestion|item)?\s*(?:to|onto|into|in)\s+(?:this|the current|our)\s+(?:thread|conversation|topic|chat)[.!]*$/i.exec(text);
  const phrase = match?.[1]?.replace(/\s+(?:idea|plan|activity|suggestion|item)$/i, "").replace(/^["“']|["”']$/g, "").trim();
  return phrase && topicTokens(phrase).length ? phrase.slice(0, 120) : null;
}

/** Resolve an idea by title among candidates: exact title, else all-token containment; unique or not at all. */
export function resolveIdea(phrase: string, items: Array<{ itemId: string; title: string }>): { kind: "none" } | { kind: "unique"; itemId: string } | { kind: "ambiguous"; itemIds: string[] } {
  const query = topicTokens(phrase);
  if (!query.length) return { kind: "none" };
  const exact = items.filter(item => topicTokens(item.title).join(" ") === query.join(" "));
  if (exact.length === 1) return { kind: "unique", itemId: exact[0].itemId };
  const pool = exact.length ? exact : items.filter(item => { const title = new Set(topicTokens(item.title)); return query.every(word => title.has(word)); });
  if (pool.length === 1) return { kind: "unique", itemId: pool[0].itemId };
  return pool.length ? { kind: "ambiguous", itemIds: pool.slice(0, 4).map(item => item.itemId) } : { kind: "none" };
}
