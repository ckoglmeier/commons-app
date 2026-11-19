import { emailBrandHtml } from "./brand";
import type { ConversationDigestPayload } from "@commons/database";
import type { RenderedEmail } from "./invitation-email";

const MAX_HIGHLIGHTS_PER_EVENT = 5;

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function safeHttpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Digest links must use HTTP or HTTPS.");
  return url.toString();
}

function eventUrl(eventsUrl: string, slug: string) {
  return safeHttpUrl(new URL(`/c/${encodeURIComponent(slug)}`, eventsUrl).toString());
}

function excerpt(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}…` : normalized;
}

function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountCents / 100);
}

function dateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year: year!, month: month!, day: day!, date: new Date(Date.UTC(year!, month! - 1, day!)) };
}

function formatTripDates(startsOn?: string | null, endsOn?: string | null) {
  if (!startsOn && !endsOn) return "";
  const start = startsOn ? dateParts(startsOn) : null;
  const end = endsOn ? dateParts(endsOn) : null;
  const full = (value: ReturnType<typeof dateParts>) => new Intl.DateTimeFormat("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(value.date);
  if (!start) return `Through ${full(end!)}`;
  if (!end || startsOn === endsOn) return full(start);
  if (start.year === end.year && start.month === end.month) {
    const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(start.date);
    return `${month} ${start.day}–${end.day}, ${start.year}`;
  }
  if (start.year === end.year) {
    const short = (value: ReturnType<typeof dateParts>) => new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", timeZone: "UTC",
    }).format(value.date);
    return `${short(start)}–${short(end)}, ${start.year}`;
  }
  return `${full(start)}–${full(end)}`;
}

function tripFacts(event: ConversationDigestPayload["events"][number]) {
  const dates = formatTripDates(event.startsOn, event.endsOn);
  const locations = [...new Set((event.locationNames?.length ? event.locationNames : [event.locationName])
    .filter((value): value is string => Boolean(value)))];
  return [dates, locations.join(" · ")].filter(Boolean).join(" · ");
}

type Highlight = { priority: number; occurredAt: string; html: string; text: string };

function eventHighlights(event: ConversationDigestPayload["events"][number]) {
  const highlights: Highlight[] = [
    ...(event.activities ?? []).map((activity) => ({
      priority: activity.priority ?? 4,
      occurredAt: activity.occurredAt,
      html: `<p style="margin:0;color:#16372F;font-size:15px;line-height:23px;">${escapeHtml(activity.summary)}</p>`,
      text: activity.summary,
    })),
    ...event.messages.map((message) => ({
      priority: 0,
      occurredAt: message.occurredAt,
      html: `<p style="margin:0 0 4px;color:#2E6758;font-size:12px;font-weight:700;line-height:17px;">${escapeHtml(message.actorName)}</p><p style="margin:0;color:#16372F;font-size:15px;line-height:23px;">${escapeHtml(excerpt(message.body))}</p>`,
      text: `${message.actorName}: ${excerpt(message.body)}`,
    })),
    ...(event.expenses ?? []).map((expense) => ({
      priority: 2,
      occurredAt: expense.addedAt,
      html: `<p style="margin:0 0 4px;color:#16372F;font-size:15px;font-weight:700;line-height:22px;">${escapeHtml(expense.title)} · ${escapeHtml(formatMoney(expense.amountCents, expense.currency))}</p><p style="margin:0;color:#5E6C67;font-size:12px;line-height:18px;">Paid by ${escapeHtml(expense.paidByName)}</p>`,
      text: `${expense.title} · ${formatMoney(expense.amountCents, expense.currency)} · Paid by ${expense.paidByName}`,
    })),
  ];
  return highlights.sort((a, b) => a.priority - b.priority || b.occurredAt.localeCompare(a.occurredAt)).slice(0, MAX_HIGHLIGHTS_PER_EVENT);
}

function eventSummary(event: ConversationDigestPayload["events"][number]) {
  return [
    (event.activityCount ?? 0) > 0 ? `${event.activityCount} ${(event.activityCount ?? 0) === 1 ? "trip change" : "trip changes"}` : "",
    event.messageCount > 0 ? `${event.messageCount} ${event.messageCount === 1 ? "message" : "messages"}` : "",
    (event.expenseCount ?? 0) > 0 ? `${event.expenseCount} ${(event.expenseCount ?? 0) === 1 ? "expense" : "expenses"}` : "",
  ].filter(Boolean).join(" · ");
}

export function renderConversationDigestEmail(input: { payload: ConversationDigestPayload; eventsUrl: string }): RenderedEmail {
  const eventsUrl = safeHttpUrl(input.eventsUrl);
  const eventCount = input.payload.events.length;
  const subject = eventCount === 1 ? `What changed in ${input.payload.events[0]!.name}` : `What changed in ${eventCount} trips`;
  const heading = "Here’s what changed.";

  const eventSections = input.payload.events.map((event) => {
    const highlights = eventHighlights(event);
    const totalOutcomes = (event.activityCount ?? 0) + event.messageCount + (event.expenseCount ?? 0);
    const omitted = Math.max(0, totalOutcomes - highlights.length);
    const facts = tripFacts(event);
    const directUrl = eventUrl(eventsUrl, event.slug);
    const rows = highlights.map((highlight) => `<tr><td style="padding:14px 0;border-top:1px solid #DCE4E0;">${highlight.html}</td></tr>`).join("");
    const directLink = eventCount > 1 ? `<tr><td style="padding-top:14px;"><a href="${escapeHtml(directUrl)}" style="display:inline-block;min-height:44px;color:#2E6758;font-size:13px;font-weight:700;line-height:44px;text-decoration:underline;">Open ${escapeHtml(event.name)}</a></td></tr>` : "";
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px;">
      <tr><td><h2 style="margin:0 0 4px;color:#16372F;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:400;line-height:31px;">${escapeHtml(event.name)}</h2>
      ${facts ? `<p style="margin:0 0 3px;color:#16372F;font-size:13px;line-height:19px;">${escapeHtml(facts)}</p>` : ""}
      <p style="margin:0 0 8px;color:#5E6C67;font-size:12px;line-height:18px;">${escapeHtml(eventSummary(event))}</p></td></tr>
      ${rows}
      ${omitted > 0 ? `<tr><td style="padding-top:10px;color:#5E6C67;font-size:12px;line-height:18px;">${omitted} more shared ${omitted === 1 ? "update" : "updates"} in Commons.</td></tr>` : ""}
      ${directLink}
    </table>`;
  }).join("");

  const primaryUrl = eventCount === 1 ? eventUrl(eventsUrl, input.payload.events[0]!.slug) : eventsUrl;
  const primaryLabel = eventCount === 1 ? `Open ${input.payload.events[0]!.name}` : "Open your trips";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title>
  <style>@media only screen and (max-width:620px){.email-shell{width:100%!important}.email-card{border-radius:20px!important}.email-pad{padding-left:24px!important;padding-right:24px!important}.email-title{font-size:38px!important;line-height:40px!important}.primary-link{display:block!important;text-align:center!important}}</style></head>
  <body style="margin:0;padding:0;background:#FFFFFF;color:#16372F;font-family:Arial,Helvetica,sans-serif;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Updates from ${eventCount === 1 ? escapeHtml(input.payload.events[0]!.name) : `${eventCount} trips`}.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFFFFF;"><tr><td align="center" style="padding:32px 12px;"><table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;">
  <tr><td style="padding:0 8px 18px;">${emailBrandHtml}</td></tr><tr><td class="email-card" style="overflow:hidden;border:1px solid #DCE4E0;border-radius:24px;background:#FFFFFF;box-shadow:0 14px 36px rgba(22,55,47,.10);"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
  <tr><td class="email-pad" style="padding:42px 44px 0;"><p style="margin:0 0 18px;color:#2E6758;font-size:12px;font-weight:700;line-height:17px;letter-spacing:.09em;text-transform:uppercase;">Daily update</p><h1 class="email-title" style="margin:0;color:#16372F;font-family:Arial,Helvetica,sans-serif;font-size:48px;font-weight:400;line-height:50px;letter-spacing:-.035em;">${escapeHtml(heading)}</h1></td></tr>
  <tr><td class="email-pad" style="padding:0 44px 42px;">${eventSections}<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:28px;"><tr><td style="border-radius:14px;background:#16372F;"><a class="primary-link" href="${escapeHtml(primaryUrl)}" style="display:inline-block;padding:15px 22px;color:#FFFFFF;font-size:15px;font-weight:700;line-height:18px;text-decoration:none;">${escapeHtml(primaryLabel)}</a></td></tr></table>
  <p style="margin:24px 0 0;color:#5E6C67;font-size:12px;line-height:19px;">Sent once a day when a trip you joined has activity. Private travel details, unshared costs, confirmation documents, and profile information are not included.</p></td></tr></table></td></tr></table></td></tr></table></body></html>`;

  const textSections = input.payload.events.map((event) => [
    event.name,
    tripFacts(event),
    eventSummary(event),
    ...eventHighlights(event).map((highlight) => highlight.text),
    `Open ${event.name}: ${eventUrl(eventsUrl, event.slug)}`,
  ].filter(Boolean).join("\n")).join("\n\n");

  return {
    subject,
    html,
    text: `${heading}\n\n${textSections}\n\nSent once a day when a trip you joined has activity. Private travel details, unshared costs, confirmation documents, and profile information are not included.`,
  };
}
