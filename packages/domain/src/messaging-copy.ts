/*
 * What Commons says by text. The speaker is Commons, not a persona. Short, warm, one useful question at a time (DESIGN.md §3): sentence case, contractions,
 * no exclamation marks, no emoji, dates and times as numerals. Every message that asks for something names its trip.
 */
import { tripLabel, type RoutableTrip } from "./messaging";

const money = (cents: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
function dates(startsOn: string | null, endsOn: string | null) {
  if (!startsOn) return "";
  const f = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return endsOn && endsOn !== startsOn ? `${f(startsOn)} to ${f(endsOn)}` : f(startsOn);
}

/*
 * Every message is a `say` template, so the words between the ${} holes are Commons's and everything in a hole is a value: a trip or person's name,
 * a poll title, an organizer's message, a plan answer, a URL. The SMS copy joins them as written; the web copy rewords only Commons's words, so
 * nothing a person wrote is ever changed (see webWording below).
 */
type Say = (strings: TemplateStringsArray, ...values: unknown[]) => string;

function copyWith(say: Say) { return {
  // The dates are left out when the question already says them ("Are you in for Feb 12 to Feb 15?").
  welcome: (input: { firstName: string; tripName: string; startsOn: string | null; endsOn: string | null; question: string }) =>
    say`Commons: Hi ${input.firstName}, this is Commons, an automated assistant for ${input.tripName}${input.startsOn && !input.question.includes(dates(input.startsOn, input.endsOn)) ? ` (${dates(input.startsOn, input.endsOn)})` : ""}. Save this number as Commons. ${input.question.charAt(0).toUpperCase()}${input.question.slice(1)} Reply STOP to opt out, HELP for help.`,
  attendance: (tripName: string, startsOn: string | null, endsOn: string | null) =>
    say`${tripName}: are you in${startsOn ? ` for ${dates(startsOn, endsOn)}` : ""}? Reply YES, NO or MAYBE.`,
  attendanceSaved: (tripName: string, value: "attending" | "maybe") =>
    value === "attending" ? say`Got it. You're in for ${tripName}. Your answer is saved on the trip.` : say`Got it. I've marked you as maybe for ${tripName}. Nothing is confirmed until you say YES.`,
  attendanceDeclineConfirm: (tripName: string) => say`${tripName}: you can't make it? Reply YES to confirm. Your invitation will close, and you can ask the organizer to add you back.`,
  attendanceDeclined: (tripName: string) => say`Okay. I've marked you as not attending ${tripName}.`,
  attendanceDeclineKept: (tripName: string) => say`Okay, I haven't changed anything for ${tripName}.`,
  attendanceOnWeb: (tripName: string, url: string) => say`${tripName}: I couldn't record that by text. Answer on the trip page: ${url}`,
  attendanceUnclear: (tripName: string) => say`${tripName}: I didn't catch that. Reply YES, NO or MAYBE.`,
  poll: (tripName: string, title: string, options: ReadonlyArray<{ key: string; label: string }>, multiple = false) =>
    say`${tripName}: ${title}\n${options.map(option => `${option.key}) ${option.label}`).join("\n")}\n${multiple ? `Reply with all that work, like ${options.slice(0, 2).map(option => option.key).join(", ")}.` : `Reply with ${options.map(option => option.key).join(", ")}.`}`,
  pollSaved: (tripName: string, labels: string | readonly string[], url: string) => say`Got it. I recorded ${(typeof labels === "string" ? [labels] : labels).map(label => `"${label}"`).join(" and ")} for ${tripName}. You can change it here: ${url}`,
  pollLink: (tripName: string, title: string, url: string) => say`${tripName}: "${title}" is waiting for your answer. It's more than I can ask by text, so it's here: ${url}`,
  pollChanged: (tripName: string) => say`${tripName}: that poll changed after I asked. Here's the updated question.`,
  pollUnavailable: (tripName: string) => say`${tripName}: I can't record that answer by text. Open the poll to answer it.`,
  pollUnclear: (tripName: string, keys: string[], multiple = false) => multiple ? say`${tripName}: reply with all that work, like ${keys.slice(0, 2).join(", ")}.` : say`${tripName}: reply with ${keys.join(", ")}.`,
  arrival: (tripName: string) => say`${tripName}: how are you getting there? Text me your flight, hotel or rental details, or reply DRIVING or LATER.`,
  arrivalDriving: (tripName: string) => say`Got it. I won't ask about travel to ${tripName} again. You can still text me a booking anytime.`,
  arrivalLater: (tripName: string) => say`Okay. I'll check in about ${tripName} travel later. You can text me a booking anytime.`,
  /** The welcome's question when there is nothing to ask yet. */
  welcomeAsk: say`Ask me about the saved plan, or text me a booking and I'll add it for your review.`,
  tripChoice: (trips: readonly RoutableTrip[]) =>
    say`Which trip is this for?\n${trips.map((trip, index) => `${index + 1}) ${tripLabel(trip)}`).join("\n")}\nReply ${trips.map((_, index) => index + 1).join(" or ")}. I haven't done anything yet.`,
  tripChoiceReask: (trips: readonly RoutableTrip[]) =>
    say`I still need to know which trip.\n${trips.map((trip, index) => `${index + 1}) ${tripLabel(trip)}`).join("\n")}\nReply ${trips.map((_, index) => index + 1).join(" or ")}.`,
  staleReply: (tripName: string) => say`${tripName}: that question has closed, so I haven't changed anything. Here's what's next.`,
  noOpenQuestion: (tripName: string) => say`${tripName}: I'm not waiting on an answer from you right now, so I haven't changed anything. You can ask about the saved plan, or text me a booking.`,
  versionChanged: (tripName: string) => say`${tripName}: that changed after I asked, so I haven't saved your answer. Here's the update.`,
  noMembership: (tripName: string) => say`${tripName}: I can't act on this trip for you anymore. Open Commons on the web to check your access.`,
  unknownSender: (signInUrl: string) => say`Commons: I don't recognize this number yet. Sign in at ${signInUrl} and turn on Text with Commons for your trip. Reply STOP to opt out.`,
  notEnrolled: (url: string) => say`Commons: texts aren't turned on for any of your trips yet. Open a trip at ${url} and choose Text with Commons. Reply STOP to opt out.`,
  // With no contact email configured, callers pass a phrase ("the trip organizer") instead of an address.
  help: (supportEmail: string) => supportEmail.includes("@")
    ? say`Commons: I'm an automated assistant for the trips you've joined by text. Ask about the saved plan, or text me a booking. Reply STOP to opt out. Help: ${supportEmail}`
    : say`Commons: I'm an automated assistant for the trips you've joined by text. Ask about the saved plan, or text me a booking. Reply STOP to opt out. For help, ask your trip organizer.`,
  startBack: (count: number, url: string) => count > 0
    ? say`Commons: you're back on. I'll text about ${count === 1 ? "your trip" : `your ${count} trips`} again. Reply STOP to opt out.`
    : say`Commons: you're back on. To get texts about a trip, open it at ${url} and choose Text with Commons.`,
  stopped: say`Commons: you're unsubscribed and won't get more texts. Your trips stay available on the web.`,
  verificationCode: (code: string) => say`Commons: your verification code is ${code}. It expires in 10 minutes. If you didn't ask for it, you can ignore this text.`,
  optedOutWeb: "Texts are off. Your trips stay available on the web.",
  receipt: (tripName: string, kind: "text" | "link" | "picture" | "file") =>
    kind === "link" ? say`Got your link for ${tripName}. I'll read it and send what I find. Nothing is saved until you approve it.`
    : kind === "picture" ? say`Got your picture for ${tripName}. I'll read it and send what I find. Nothing is saved until you approve it.`
    : kind === "file" ? say`Got your file for ${tripName}. I'll read it and send what I find. Nothing is saved until you approve it.`
    : say`Got your booking details for ${tripName}. I'll read them and send what I find. Nothing is saved until you approve it.`,
  notReadable: (tripName: string, reviewUrl: string) => say`${tripName}: I couldn't read booking details from that. Paste the confirmation text, or add it on this page: ${reviewUrl}`,
  linkUnreadable: (tripName: string, reviewUrl: string) => say`${tripName}: I couldn't read that link. Paste the confirmation text instead, or add it on this page: ${reviewUrl}`,
  mediaUnsupported: (tripName: string, reviewUrl: string) => say`${tripName}: I can't read that kind of file by text. Add it on this page and I'll read it there: ${reviewUrl}`,
  stayNeedsOrganizer: (tripName: string) => say`${tripName}: lodging is added to the trip by an organizer, so I can't save this stay for you. I haven't shared it with anyone. You can send it to an organizer yourself.`,
  duplicate: (tripName: string) => say`${tripName}: that booking is already saved, so I haven't added it again.`,
  duplicateSource: (tripName: string) => say`${tripName}: I already have those details and I'm waiting on your answer to the summary I sent.`,
  review: (input: { tripName: string; lines: string[]; sharing: string; uncertain: string[]; classification: "new" | "change" | "cancellation"; code: string; reviewUrl: string }) => {
    const head = input.classification === "change" ? say`${input.tripName}: this looks like a change to a booking I already have. It would replace the saved details.`
      : input.classification === "cancellation" ? say`${input.tripName}: this looks like a cancellation. Saving removes the matching booking from your trip.`
      : say`${input.tripName}: here's what I read. Nothing is saved yet.`;
    const unsure = input.uncertain.length ? `\nCheck: ${input.uncertain.slice(0, 3).join(" ")}` : "";
    return say`${head}\n${input.lines.join("\n")}\n${input.sharing}${unsure}\nReply SAVE ${input.code} to save, or DISCARD to drop it. Edit first: ${input.reviewUrl}`;
  },
  reviewStaleCode: (tripName: string, code: string) => say`${tripName}: that code doesn't match the latest summary. The current code is ${code}. Reply SAVE ${code} if the latest summary is right.`,
  reviewSaved: (tripName: string, what: "saved" | "updated" | "removed") =>
    what === "removed" ? say`Done. I removed that booking from ${tripName}.` : say`Done. ${what === "updated" ? "I updated" : "I saved"} your booking for ${tripName}. You can edit it on the Travel page.`,
  reviewDiscarded: (tripName: string) => say`Okay. I discarded those booking details for ${tripName}. Nothing was saved.`,
  reviewNeedsPage: (tripName: string, reviewUrl: string) => say`${tripName}: that change needs your review on the web, so I haven't saved it: ${reviewUrl}`,
  reviewFailed: (tripName: string, reviewUrl: string) => say`${tripName}: I couldn't save that. Nothing was changed. Review it here: ${reviewUrl}`,
  moneyAsk: (tripName: string, question: string) => say`${tripName}: ${question} Nothing is saved yet. Reply DISCARD to drop it.`,
  moneyExpenseReview: (input: { tripName: string; description: string; amount: string; day: string; dayAssumed: boolean; currencyAssumed: boolean; currency: string; people: string; perPerson: string | null; duplicate: boolean; code: string }) =>
    say`${input.tripName}: here's what I'd add to Money. Nothing is saved yet.\n${input.description}, ${input.amount}${input.currencyAssumed ? ` (${input.currency}, the trip's currency)` : ""}\n${input.day}${input.dayAssumed ? " (today, since you didn't say)" : ""}\nPaid by you\nSplit equally: ${input.people}${input.perPerson ? ` (about ${input.perPerson} each)` : ""}${input.duplicate ? "\nThis looks like one already saved. Saving adds a second." : ""}\nReply SAVE ${input.code} to save, or DISCARD to drop it. To change it, send it again.`,
  moneyPaymentReview: (input: { tripName: string; amount: string; currencyAssumed: boolean; currency: string; toName: string; code: string }) =>
    say`${input.tripName}: you paid ${input.toName} ${input.amount}${input.currencyAssumed ? ` (${input.currency}, the trip's currency)` : ""}? Commons doesn't move money. This tells them you paid outside Commons, and balances change once they or an organizer record it.\nReply SAVE ${input.code} to send the report, or DISCARD to drop it.`,
  moneyExpenseSaved: (tripName: string, description: string, url: string) => say`Done. I added ${description} to ${tripName}. You can edit it in Money: ${url}`,
  moneyPaymentSaved: (tripName: string, toName: string, url: string) => say`Done. I noted your payment to ${toName} on ${tripName}. Balances haven't changed yet. ${toName} or an organizer still needs to record it: ${url}`,
  moneyDiscarded: (tripName: string) => say`Okay. I dropped that for ${tripName}. Nothing was saved.`,
  moneyFailed: (tripName: string, url: string) => say`${tripName}: I couldn't save that, so nothing changed. You can add it in Money: ${url}`,
  moneySomeoneElse: (tripName: string, url: string) => say`${tripName}: I can only add what you paid yourself by text. To add what someone else paid, use Money: ${url}`,
  organizerShare: (tripName: string, organizerName: string, body: string) =>
    say`${tripName}, from ${organizerName} (organizer): ${body}\nReplies come to Commons, not ${organizerName.trim().split(/\s+/)[0] || "the organizer"}.`,
  planAnswer: (tripName: string, answer: string) => say`${tripName} (from the saved plan): ${answer}`,
  planUnknown: (tripName: string) => say`${tripName}: I don't have that saved yet, so I won't guess. The organizer can add it to the plan.`,
  planNotPermitted: (tripName: string) => say`${tripName}: I can answer simple questions about the saved plan, like where you're staying or when the trip starts.`,
  change: (tripName: string, summary: string, url: string) => say`${tripName}: ${summary} Open the plan: ${url}`,
  settlement: (tripName: string, owed: string, url: string) => say`${tripName}: ${owed} is still open for you. Pay outside Commons, then mark it paid in Money: ${url}`,
  money,
  dates,
}; }

/** The consent version recorded when a person turns on messages in Commons (no phone, no carrier terms). */
export const WEB_MESSAGES_CONSENT_WORDING = "web-v1";
export const WEB_MESSAGES_CONSENT_TEXT = (tripName: string) => `Get messages from Commons about ${tripName} here in Commons. Commons is an automated assistant: it asks one thing at a time, answers from the saved plan, and saves nothing until you approve it. Turn it off anytime.`;
/** The longest organizer share: one screen on a phone. */
export const ORGANIZER_SHARE_MAX_LENGTH = 480;
export const ORGANIZER_SHARES_PER_DAY = 3;

const WEB_WORDING: ReadonlyArray<readonly [RegExp, string]> = [
  [/ Save this number as Commons\./g, ""],
  [/ Reply STOP to opt out, HELP for help\./g, ""],
  [/ Reply STOP to opt out\./g, ""],
  [/\bText me\b/g, "Send me"],
  [/\btext me\b/g, "send me"],
  [/\bthe trips you've joined by text\b/g, "the trips you've turned messages on for"],
  [/\bby text\b/g, "here"],
  [/\bI'll text about\b/g, "I'll message you about"],
  [/\bTo get texts about a trip\b/g, "To get messages about a trip"],
  [/\bchoose Text with Commons\b/g, "choose Messages from Commons"],
  [/\btexts for (.+?) start once\b/g, "messages for $1 start once"],
  [/\bTexts for (.+?) start once\b/g, "Messages for $1 start once"],
  [/\btexts aren't turned on\b/g, "messages aren't turned on"],
  [/^You're unsubscribed and won't get more texts\. Your trips stay available on the web\.$/, "You're unsubscribed and won't get more messages from Commons. Send START to turn them back on."],
];
/** Commons's own words only: a template with each value held out as a hole, never a finished message. */
function webWording(template: string) {
  // The thread already says who is speaking, so the "Commons:" a phone needs is dropped.
  const unprefixed = template.replace(/^Commons: (.)/, (_, first: string) => first.toUpperCase());
  return WEB_WORDING.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), unprefixed).trim();
}

const plain: Say = (strings, ...values) => strings.reduce((text, part, index) => `${text}${values[index - 1]}${part}`);
// Private-use marks stand in for the values while the words are reworded, then each value goes back exactly as it was, in one pass that never rereads it.
const hole = (index: number) => `\uE000${index}\uE001`;
const web: Say = (strings, ...values) => webWording(plain(strings, ...values.map((_, index) => hole(index)))).replace(/\uE000(\d+)\uE001/g, (_, index: string) => `${values[Number(index)]}`);

/** What Commons says by text. */
export const messagingCopy = copyWith(plain);
/**
 * The same messages in a person's thread in Commons. The conversation is identical; only Commons's words about the channel change: no number to save,
 * no carrier STOP line (the thread has its own Turn off), and "send" instead of "text". Chosen per address where a message is written (`copyFor`).
 */
export const webMessagingCopy: MessagingCopy = copyWith(web);
export type MessagingCopy = ReturnType<typeof copyWith>;

export type MessagePart = { text: string; href?: string };
/**
 * A message from Commons as text and links, for the web thread. Only http(s) links to this site's own origin become links; any other URL, and
 * everything when the origin is unknown, stays text. Punctuation that ends a sentence is never part of a link.
 */
export function messageParts(body: string, siteOrigin: string | null | undefined): MessagePart[] {
  let origin: string | null = null;
  try { origin = siteOrigin ? new URL(siteOrigin).origin : null; } catch { origin = null; }
  if (!origin) return [{ text: body }];
  const parts: MessagePart[] = [];
  let last = 0;
  for (const match of body.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const url = match[0].replace(/[.,)!?]+$/, ""), start = match.index!;
    let same = false;
    try { same = new URL(url).origin === origin; } catch { same = false; }
    if (!same) continue;
    if (start > last) parts.push({ text: body.slice(last, start) });
    parts.push({ text: url, href: url });
    last = start + url.length;
  }
  if (last < body.length || !parts.length) parts.push({ text: body.slice(last) });
  return parts;
}
