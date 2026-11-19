import { z } from "zod";

export type OrganizerInviteRequest = { recipients: Array<{ email: string; displayName: string }>; error: string | null; review?: boolean };
const emailSchema = z.string().email().max(254);
const command = /^(?:(?:can|could|would) you\s+|(?:I'd like to|I would like to|I want to|let's)\s+)?(?:please\s+)?(?:invite(?=\s|:|$)|send\s+(?:trip\s+)?(?:invites?|invitations?)\s+to(?=\s|:|$))\s*/i;

/** Explicit organizer instructions only. No model, history mining, inferred recipients, or role grants. */
export function parseOrganizerInvites(text: string, awaitingList = false): OrganizerInviteRequest | null {
  let trimmed = text.trim();
  const adding = /^(?:(?:can|could|would) you\s+)?(?:please\s+)?add\s+(?:these\s+)?(?:people|travelers)(?:\s+as\s+travelers)?\s*:/i.exec(trimmed);
  if (adding) {
    const parsed = parseOrganizerInvites(`Invite ${trimmed.slice(adding[0].length)}`);
    return parsed ? { ...parsed, review: true } : null;
  }
  const listThenRequest = trimmed.match(/^(?:Here (?:are|is) (?:the |their )?(?:email addresses|emails|addresses|list):?\s*)?([\s\S]+?)[.\n]\s*(?:Please\s+)?invite (?:them|these people)(?: to (?:this|the|our) trip)?[.!?]?$/i);
  if (listThenRequest) {
    const listed = parseOrganizerInvites(listThenRequest[1], true);
    if (listed && !listed.error) trimmed = `Invite ${listThenRequest[1]}`;
  }
  const explicit = command.test(trimmed);
  if (!explicit && (!awaitingList || !trimmed.includes("@"))) return null;
  let list = (explicit ? trimmed.replace(command, "") : trimmed).replace(/^:\s*/, "");
  if (/\b(?:organizers?|admins?|owners?|tomorrow|later|unless|except|don't|do not|not yet|draft|preview)\b/i.test(list.replace(/[^,;\n<>]+<[^<>]+>/g, "").replace(/[^\s<>;,]+@[^\s<>;,]+/g, ""))) {
    return explicit ? { recipients: [], error: "Paste only the email addresses to invite now as Travelers. Manage organizer roles separately in People." } : null;
  }
  list = list.replace(/^(?:(?:these|the following)(?:\s+(?:people|travelers|email addresses|emails))?|them|people)(?=\s|:|$)\s*(?:to\s+(?:this|the|our)\s+trip)?\s*:?\s*/i, "")
    .replace(/\s+to\s+(?:this|the|our)\s+trip[.!?]?$/i, "").replace(/[.!?]$/, "").trim();
  if (!list) return { recipients: [], error: "Paste the email addresses you want me to invite as Travelers. You can separate them with commas or put one on each line." };
  const entries = list.split(/[,;\n]+|\s+and\s+|(?<=\S)\s+(?=[^\s<>]+@)/i).map(value => value.trim()).filter(Boolean);
  const recipients: OrganizerInviteRequest["recipients"] = [];
  for (const entry of entries) {
    const named = entry.match(/^([^<>\n]{1,80})\s*<([^<>\s]+)>?$/);
    const email = (named?.[2] ?? entry).toLowerCase();
    if (!emailSchema.safeParse(email).success) return { recipients: [], error: "I couldn’t read the whole address list, so no invitations were created. Paste valid email addresses separated by commas or new lines, optionally as Name <email>." };
    if (!recipients.some(person => person.email === email)) recipients.push({ email, displayName: named?.[1].trim() || email.slice(0, 80) });
  }
  if (!recipients.length) return { recipients: [], error: "Paste the email addresses you want me to invite as Travelers." };
  if (recipients.length > 24) return { recipients: [], error: "Please send up to 24 email addresses at a time. No invitations were created." };
  return { recipients, error: null };
}
