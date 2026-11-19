import { PollCommunicationSchema, type PollCommunication } from "@commons/contracts";

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

function paragraphHtml(value: string) {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^-{5,}$/.test(line));
  const output: string[] = [];
  let items: string[] = [];
  const flush = () => { if (items.length) output.push(`<ul style="margin:0 0 16px;padding-left:22px">${items.map(item => `<li style="margin:0 0 6px">${escape(item)}</li>`).join("")}</ul>`); items = []; };
  for (const line of lines) {
    const bullet = line.match(/^[-•*]\s*(.+)$/);
    if (bullet) items.push(bullet[1]);
    else { flush(); output.push(`<p style="margin:0 0 16px">${escape(line)}</p>`); }
  }
  flush();
  return output.join("");
}

export function pollCommunicationHtml(raw: PollCommunication) {
  const message = PollCommunicationSchema.parse(raw);
  return `<h2 style="margin:0 0 16px;font-size:22px;line-height:1.3">${escape(message.heading)}</h2>${message.paragraphs.map(paragraphHtml).join("")}${message.links.length ? `<ul style="margin:0 0 20px;padding-left:22px">${message.links.map(link => `<li style="margin:0 0 6px"><a href="${escape(link.url)}">${escape(link.label)}</a></li>`).join("")}</ul>` : ""}`;
}
export function pollCommunicationText(message: PollCommunication) {
  return [message.heading, ...message.paragraphs, ...message.links.map(link => `${link.label}: ${link.url}`)].join("\n\n");
}
