import { itineraryMessageText, itineraryMessageHtml } from "./itinerary-message";
import type { PollWorkingData } from "@commons/contracts";
import { pollCommunicationHtml, pollCommunicationText } from "./poll-communication";

/** Copying never changes the published poll's access rules. */
export const publishedPollAccessScope = "This link keeps the poll’s existing access rules. It doesn’t grant trip membership.";

export function publishedPollUrl(origin: string, publicId: string) {
  return `${origin.replace(/\/$/, "")}/c/poll/${publicId}`;
}

export function publishedPollMessage(data: PollWorkingData, url: string) {
  const outline = itineraryMessageText(data);
  if (outline) return `${outline}\n\nRespond in Commons: ${url}`;
  const message = data.communication;
  if (data.presentationVersion !== 2 && message) return `${pollCommunicationText(message)}\n\nVote in Commons: ${url}`;
  return [message?.heading, ...(message?.paragraphs ?? []), ...(message?.links.map(link => `${link.label}: ${link.url}`) ?? []), data.title, data.intro, ...data.questions.map(question => `${question.prompt}${question.kind === "choice" ? `\n${question.options.map(option => `• ${option.label}`).join("\n")}` : "\nWritten response"}`), `Vote in Commons: ${url}`].filter(Boolean).join("\n\n");
}

export function publishedPollSms(data: PollWorkingData, url: string) {
  return [data.title, `Vote: ${url}`].join("\n\n");
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function safeLink(label: string, url: string) {
  try {
    if (["https:", "http:"].includes(new URL(url).protocol)) return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
  } catch { /* Invalid links remain readable, never executable. */ }
  return escapeHtml(label);
}

export function publishedPollHtml(data: PollWorkingData, url: string) {
  const outline = itineraryMessageHtml(data);
  if (outline) return `<div>${outline}<p>${safeLink("Respond in Commons", url)}</p></div>`;
  const message = data.communication;
  if (data.presentationVersion !== 2 && message) return `<div>${pollCommunicationHtml(message)}<p>${safeLink("Vote in Commons", url)}</p></div>`;
  return `<div>${message ? pollCommunicationHtml(message) : ""}<hr><p><strong>Commons poll</strong></p><h2>${escapeHtml(data.title)}</h2>${data.intro ? `<p>${escapeHtml(data.intro)}</p>` : ""}${data.questions.map(question => `<p><strong>${escapeHtml(question.prompt)}</strong></p>${question.kind === "choice" ? `<ul>${question.options.map(option => `<li>${escapeHtml(option.label)}</li>`).join("")}</ul>` : ""}`).join("")}<p>${safeLink("Vote in Commons", url)}</p></div>`;
}

export async function copyPublishedMessage(data: PollWorkingData, url: string): Promise<"formatted" | "plain" | "manual"> {
  const text = publishedPollMessage(data, url);
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([publishedPollHtml(data, url)], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      return "formatted";
    }
  } catch { /* Some clients allow plain copying but reject rich clipboard. */ }
  try { await navigator.clipboard.writeText(text); return "plain"; }
  catch { return "manual"; }
}
