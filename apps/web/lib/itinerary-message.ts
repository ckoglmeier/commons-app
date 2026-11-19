import { PollCommunicationSchema, type PollCommunication, PollQuestion, PollWorkingData } from "@commons/contracts";
import { itineraryQuestion } from "./itinerary-workshop";
export type ItineraryMessageSource = { title: string; intro?: string | null; communication?: PollCommunication | null; questions: Array<PollQuestion | PollWorkingData["questions"][number]> };
export const itineraryClosing = "What would you change or add? Share suggestions for the open stops and flag anything you’d like to join.";
export const outlineTime = (value: string) => /^(?:time open|day open)$/i.test(value.trim()) ? "" : value;
/** All renderers consume this participant-safe saved projection, never the private itinerary. */
export function itineraryMessageContent(data: ItineraryMessageSource, allowLegacy = false) {
  const question = itineraryQuestion(data.questions);
  if (!question || (!allowLegacy && question.itinerary.feedbackMode !== "pieces")) return null;
  const communication = data.communication ? PollCommunicationSchema.parse(data.communication) : null;
  return { links: communication?.links ?? [], itinerary: question.itinerary, opening: communication?.paragraphs.length ? communication.paragraphs : data.intro ? [data.intro] : [], questions: data.questions.filter(question => question.kind === "text").map(question => ({ id: question.id, prompt: question.prompt })), closing: question.itinerary.closing ?? itineraryClosing };
}
export function itineraryMessageText(data: ItineraryMessageSource) {
  const content = itineraryMessageContent(data); if (!content) return null;
  const stop = (item: { time?: string; title: string; details: string; venue?: string }) => `• ${item.time && outlineTime(item.time) ? `${outlineTime(item.time)} · ` : ""}${item.title}${item.details ? ` — ${item.details}` : ""}${item.venue ? ` · ${item.venue}` : ""}`;
  return [content.itinerary.title, ...content.opening,
    ...content.itinerary.days.flatMap(day => [day.label, ...(day.description ? [day.description] : []), ...day.items.flatMap(item => [stop(item), ...(item.choices ? [`${item.choices.question}: ${item.choices.options.map(option => option.label).join(" / ")}`] : [])])]),
    ...(content.itinerary.otherIdeas.length ? ["Other ideas if they fit", ...content.itinerary.otherIdeas.map(stop)] : []),
    ...content.questions.map(question => question.prompt), ...content.links.map(link => `${link.label}: ${link.url}`), ...(content.closing ? [content.closing] : [])].join("\n\n");
}
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export function itineraryMessageHtml(data: ItineraryMessageSource) {
  const content = itineraryMessageContent(data); if (!content) return null;
  const stop = (item: { time?: string; title: string; details: string; venue?: string }) => `<li>${item.time && outlineTime(item.time) ? `${escape(outlineTime(item.time))} · ` : ""}<strong>${escape(item.title)}</strong>${item.details ? ` — ${escape(item.details)}` : ""}${item.venue ? ` · ${escape(item.venue)}` : ""}</li>`;
  return `<h2>${escape(content.itinerary.title)}</h2>${content.opening.map(text => `<p>${escape(text)}</p>`).join("")}${content.itinerary.days.map(day => `<h3>${escape(day.label)}</h3>${day.description ? `<p>${escape(day.description)}</p>` : ""}<ul>${day.items.map(item => `${stop(item)}${item.choices ? `<li>${escape(item.choices.question)}: ${item.choices.options.map(option => escape(option.label)).join(" / ")}</li>` : ""}`).join("")}</ul>`).join("")}${content.itinerary.otherIdeas.length ? `<h3>Other ideas if they fit</h3><ul>${content.itinerary.otherIdeas.map(stop).join("")}</ul>` : ""}${content.questions.length ? `<ul>${content.questions.map(question => `<li>${escape(question.prompt)}</li>`).join("")}</ul>` : ""}${content.links.map(link => `<p><a href="${escape(link.url)}">${escape(link.label)}</a></p>`).join("")}<p>${escape(content.closing)}</p>`;
}

/** Stable DOM/projection identity only; never an access token or saved command ID. */
export function itineraryProjectionId(documentId:string,key:string) {
  const text=`${documentId}:${key}`;
  const words=[0x811c9dc5,0x9e3779b9,0x85ebca6b,0xc2b2ae35];
  for(let index=0;index<text.length;index++) for(let word=0;word<words.length;word++) words[word]=Math.imul(words[word]^text.charCodeAt(index)^(index+word),0x01000193);
  const hex=words.map(word=>(word>>>0).toString(16).padStart(8,"0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`;
}
