import type { OperatorNotificationPayload } from "@commons/database/schema";
import { feedbackPagePath } from "@commons/contracts";
import { emailBrandHtml } from "./brand";
import type { RenderedEmail } from "./invitation-email";

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function reportDateLabel(periodKey: string) {
  const [year, month, day] = periodKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year!, month! - 1, day!)));
}

function renderDailyAnalyticsEmail(payload: Extract<OperatorNotificationPayload, { kind: "daily_analytics" }>, origin: string): RenderedEmail {
  const { report } = payload;
  const subject = `Commons daily report: ${reportDateLabel(report.periodKey)}`;
  const traffic = `${formatCount(report.activePeople)} signed-in people · ${formatCount(report.sessions)} sessions · ${formatCount(report.pageViews)} page views`;
  const happened = [
    [report.tripsCreated, "trip created", "trips created"], [report.peopleCreated, "account created", "accounts created"], [report.invitationsSent, "invite sent", "invites sent"], [report.invitationsAccepted, "invite accepted", "invites accepted"], [report.messages, "message", "messages"], [report.pollsCreated, "poll created", "polls created"], [report.pollResponses, "poll response", "poll responses"], [report.plansAdded, "plan added", "plans added"], [report.staysAdded, "stay added", "stays added"], [report.expensesAdded, "expense added", "expenses added"], [report.photosAdded, "photo added", "photos added"],
  ].filter(([value]) => Number(value) > 0).map(([value, singular, plural]) => `${formatCount(Number(value))} ${Number(value) === 1 ? singular : plural}`);
  const attention = [[report.feedbackSubmitted, "feedback item", "feedback items"], [report.betaAccessRequested, "beta-access request", "beta-access requests"]]
    .filter(([value]) => Number(value) > 0).map(([value, singular, plural]) => `${formatCount(Number(value))} ${Number(value) === 1 ? singular : plural}`);
  const topEvents = report.topEvents.filter(event => event.name !== "page_view");
  const url = new URL("/admin", origin).toString();
  const section = (label: string, content: string) => `<tr><td style="padding:18px 0;border-top:1px solid #DCE4E0;"><p style="margin:0 0 6px;color:#2E6758;font-size:12px;font-weight:700;letter-spacing:.08em;line-height:17px;text-transform:uppercase;">${escapeHtml(label)}</p><p style="margin:0;color:#16372F;font-size:16px;line-height:24px;">${escapeHtml(content)}</p></td></tr>`;
  const top = topEvents.length ? topEvents.map(event => `${formatCount(event.count)} ${event.name.replaceAll("_", " ")}`).join(" · ") : "No named product actions recorded.";
  const noActivity = happened.length ? happened.join(" · ") : "No shared actions recorded yesterday.";
  const followUp = attention.length ? attention.join(" · ") : "No new feedback or access requests.";
  // Free beta activation, from saved records and server outcomes only; internal accounts and the sample are excluded.
  const funnel = report.funnel ?? {};
  const activationLabels: Array<[string, string]> = [["tripsCreated", "trips created"], ["tripsWithSharedArtifact", "with a shared poll or sent invite"], ["tripsWithParticipantAction", "with a participant action"], ["tripsWithOrganizerReturn", "with an organizer return"], ["originalOrganizerRepeatCreators", "repeat organizers"], ["participantOriginatedTrips", "started by a former participant"]];
  const activationParts = activationLabels.filter(([key]) => typeof funnel[key] === "number").map(([key, label]) => `${formatCount(Number(funnel[key]))} ${label}`);
  const outcomeEntries = Object.entries((typeof funnel.outcomes === "object" ? funnel.outcomes : {}) as Record<string, number>).filter(([, value]) => value > 0);
  const failureEntries = Object.entries((typeof funnel.failures === "object" ? funnel.failures : {}) as Record<string, number>).filter(([, value]) => value > 0);
  const activation = report.funnel ? [activationParts.join(" · ") || "No trips created.", outcomeEntries.length ? `Saved: ${outcomeEntries.map(([name, value]) => `${formatCount(value)} ${name.replaceAll("_", " ")}`).join(" · ")}` : "", failureEntries.length ? `Failed: ${failureEntries.map(([name, value]) => `${formatCount(value)} ${name.replaceAll("_", " ")}`).join(" · ")}` : ""].filter(Boolean).join(" · ") : null;
  return {
    subject,
    text: `${subject}\n\nTraffic\n${traffic}\n\nWhat happened\n${noActivity}\n\nNeeds attention\n${followUp}${activation ? `\n\nFree beta activation\n${activation}` : ""}\n\nMost-used actions\n${top}\n\nOpen Commons admin: ${url}\n\nThis is an aggregate operating report. It does not include trip messages, receipts, or private travel details.`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#FFFFFF;color:#16372F;font-family:Arial,Helvetica,sans-serif"><main style="max-width:560px;margin:auto;padding:32px 24px">${emailBrandHtml}<p style="margin:32px 0 10px;color:#2E6758;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Daily operating report</p><h1 style="margin:0 0 26px;color:#16372F;font-size:32px;font-weight:500;letter-spacing:-.02em;line-height:1.15">${escapeHtml(reportDateLabel(report.periodKey))}</h1><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${section("Traffic", traffic)}${section("What happened", noActivity)}${section("Needs attention", followUp)}${activation ? section("Free beta activation", activation) : ""}${section("Most-used actions", top)}</table><a href="${escapeHtml(url)}" style="display:inline-block;margin-top:20px;padding:14px 20px;border-radius:14px;background:#16372F;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none">Open Commons admin</a><p style="margin:24px 0 0;color:#5E6C67;font-size:12px;line-height:18px">Aggregate operating data only. No trip messages, receipts, or private travel details are included.</p></main></body></html>`,
  };
}

export function renderOperatorNotificationEmail(payload: OperatorNotificationPayload, origin: string): RenderedEmail {
  if (payload.kind === "daily_analytics") return renderDailyAnalyticsEmail(payload, origin);
  if (payload.kind === "traffic_alert") {
    const line = `${formatCount(payload.count)} ${payload.label} in the hour starting ${payload.hour}. The alert level is ${formatCount(payload.level)}.`;
    const url = new URL("/admin/beta/", origin).toString();
    return { subject: `Commons traffic alert: ${payload.label}`, text: `${line}\n\nReview: ${url}`, html: `<!doctype html><html lang="en"><body><p>${escapeHtml(line)}</p><p><a href="${escapeHtml(url)}">Open the operator page</a></p></body></html>` };
  }
  const site = new URL(origin);
  if (!["http:", "https:"].includes(site.protocol)) throw new Error("Invalid site origin.");
  let subject: string;
  let content: string;
  let action: string;
  let path: string;
  if (payload.kind === "beta_access") {
    subject = "Commons: new beta access request";
    content = `${payload.email} requested access to create trips.\n\nTheir email is verified. This email does not approve access.`;
    action = "Review access requests";
    path = "/admin";
  } else {
    const input = payload.submission;
    const category = input.questionVersion === 2
      ? input.answers.category === "problem" ? "Problem reported" : "Improvement suggested"
      : "Demo feedback";
    subject = `Commons: ${category.toLowerCase()}`;
    const message = input.questionVersion === 2 ? input.answers.message
      : Object.entries(input.answers).map(([question, answer]) => `${question}: ${answer}`).join("\n\n");
    path = feedbackPagePath(input.pagePath);
    content = `${category}\nFeedback reference: ${payload.feedbackId}\nFrom: ${input.respondentName || "Name not provided"} (name supplied by the browser)\nPage: ${path}\n\n${message}`;
    action = "Open page in Commons";
  }
  const url = new URL(path, site.origin).toString();
  return {
    subject,
    text: `${content}\n\n${action}: ${url}`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#FFFFFF;color:#16372F;font-family:Arial,Helvetica,sans-serif"><main style="max-width:560px;margin:auto;padding:32px 24px">${emailBrandHtml}<h1 style="font-size:24px;line-height:1.3;margin:32px 0 20px">${escapeHtml(subject.replace("Commons: ", ""))}</h1><p style="font-size:16px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(content)}</p><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 20px;margin-top:16px;border-radius:14px;background:#16372F;color:#FFFFFF;font-weight:700;text-decoration:none">${action}</a></main></body></html>`,
  };
}
