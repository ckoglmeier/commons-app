import { itineraryMessageText, itineraryMessageHtml } from "../itinerary-message";
import { emailBrandHtml } from "./brand";
import type { RenderedEmail } from "./invitation-email";
import { pollQuestionFormat, type PollCommunication, type PollQuestion } from "@commons/contracts";
import { pollCommunicationHtml, pollCommunicationText } from "../poll-communication";

export type PollEmailContent = { title: string; intro: string | null; questions: PollQuestion[]; communication?: PollCommunication | null; communicationMode?: "legacy" | "separated" };
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
function pollBlock(content: PollEmailContent, url: string) {
  const questions = content.questions.map(question => `<div style="margin:20px 0 0"><p style="margin:0 0 10px;font-weight:700">${escape(question.prompt)}</p><p>${escape(pollQuestionFormat(question))}</p>${question.kind !== "text" ? `<ul style="margin:0;padding-left:22px">${question.options.map(option => `<li style="margin:0 0 7px">${escape(option.label)}</li>`).join("")}</ul>` : `<p style="margin:0;color:#5E6C67">Written response</p>`}</div>`).join("");
  return `<div style="margin:28px 0 0;padding:24px;border:1px solid #DCE4E0;border-radius:16px;background:#F7F6F2"><p style="margin:0 0 8px;color:#2E6758;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Commons poll</p><h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;font-weight:600">${escape(content.title)}</h1>${content.intro ? `<p style="margin:0 0 16px">${escape(content.intro)}</p>` : ""}${questions}<p style="margin:24px 0 0"><a href="${escape(url)}" style="display:inline-block;background:#16372F;color:#fff;padding:14px 20px;border-radius:12px;text-decoration:none;font-weight:700">Vote in Commons</a></p></div>`;
}

/** Deliberately excludes event names, questions, results, and respondent context. */
export function renderPollEmail(origin: string, publicId: string, content?: PollEmailContent | null): RenderedEmail {
  if (!/^[a-f0-9]{12}$/.test(publicId)) throw new Error("Invalid poll link.");
  const base = new URL(origin);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) throw new Error("Invalid email origin.");
  const url = new URL(`/c/poll/${publicId}`, base.origin).href;
  const outlineText = content ? itineraryMessageText(content) : null, outlineHtml = content ? itineraryMessageHtml(content) : null;
  if (content && outlineText && outlineHtml) return { subject: content.title, text: `${outlineText}\n\nRespond in Commons: ${url}`, html: `<div style="color:#16372F;font-family:Arial,Helvetica,sans-serif;line-height:1.6;max-width:560px;margin:auto;padding:24px">${emailBrandHtml}${outlineHtml}<p><a href="${escape(url)}">Respond in Commons</a></p></div>` };
  if (content) return {
    subject: content.communication?.heading || content.title,
    text: content.communicationMode === "legacy" && content.communication
      ? `${pollCommunicationText(content.communication)}\n\nVote in Commons: ${url}\n\nSign in with the email that received this link.`
      : `${content.communication ? `${pollCommunicationText(content.communication)}\n\n` : ""}${content.title}${content.intro ? `\n${content.intro}` : ""}\n\n${content.questions.map(question => `${question.prompt}\n${pollQuestionFormat(question)}${question.kind !== "text" ? `\n${question.options.map(option => `• ${option.label}`).join("\n")}` : "\nWritten response"}`).join("\n\n")}\n\nVote in Commons: ${url}\n\nSign in with the email that received this link.`,
    html: `<div style="color:#16372F;font-family:Arial,Helvetica,sans-serif;line-height:1.6;max-width:560px;margin:auto;padding:24px">${emailBrandHtml}${content.communication ? `<div style="margin-top:28px">${pollCommunicationHtml(content.communication)}</div>` : ""}${content.communicationMode === "legacy" ? `<p style="margin:24px 0 0"><a href="${escape(url)}" style="display:inline-block;background:#16372F;color:#fff;padding:14px 20px;border-radius:12px;text-decoration:none;font-weight:700">Vote in Commons</a></p>` : pollBlock(content, url)}<p style="color:#5E6C67;font-size:13px">Sign in with the email that received this link.</p></div>`,
  };
  return {
    subject: "Help shape a trip on Commons",
    text: `You have a poll to review on Commons.\n\nOpen your poll: ${url}\n\nSign in with the email that received this link. Responding does not confirm attendance.`,
    html: `<div style="background:#FFFFFF;padding:32px 20px;color:#16372F;font-family:Arial,sans-serif"><div style="max-width:520px;margin:auto;background:#FFFFFF;padding:28px">${emailBrandHtml}<h1 style="font-family:Arial,Helvetica,sans-serif">Help shape a trip.</h1><p>You have a poll to review on Commons.</p><p><a href="${url}" style="display:inline-block;background:#16372F;color:#fff;padding:16px 24px;border-radius:12px;text-decoration:none">Open your poll</a></p><p>Sign in with the email that received this link. Responding does not confirm attendance.</p></div></div>`,
  };
}
