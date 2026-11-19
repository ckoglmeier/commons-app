import { emailBrandHtml } from "./brand";
import type { RenderedEmail } from "./invitation-email";

export type MessageNoticeEmailInput = { recipientName?: string; tripNames: string[]; threadUrl: string };

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function tripsPhrase(names: string[]) {
  const unique = [...new Set(names.map(name => name.trim()).filter(Boolean))];
  if (!unique.length) return "your trip";
  if (unique.length === 1) return unique[0]!;
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.length} of your trips`;
}

/**
 * The email that says Commons left a new message in someone's thread. It carries no message text: the thread is private, so the email
 * only says there is something to read and links to it.
 */
export function renderMessageNoticeEmail(input: MessageNoticeEmailInput): RenderedEmail {
  const url = new URL(input.threadUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Message links must use HTTP or HTTPS.");
  const trips = tripsPhrase(input.tripNames);
  const greeting = input.recipientName?.trim() ? `Hi ${input.recipientName.trim()},` : "Hi,";
  const subject = `New message from Commons about ${trips}`;
  const line = `Commons has a new message for you about ${trips}.`;
  const text = `${greeting}\n\n${line} Open your messages to read and reply:\n${url.toString()}\n\nYou get one email until you open your messages. To stop these emails, turn off message emails on your profile, or reply STOP in your messages.\n`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#FFFFFF;color:#16372F;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;margin:0 auto;"><tr><td>
    ${emailBrandHtml}
    <p style="margin:28px 0 0;font-size:17px;line-height:26px;">${escapeHtml(greeting)}</p>
    <p style="margin:12px 0 0;font-size:17px;line-height:26px;">${escapeHtml(line)}</p>
    <p style="margin:28px 0 0;"><a href="${escapeHtml(url.toString())}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#16372F;color:#FFFFFF;font-weight:700;text-decoration:none;">Open your messages</a></p>
    <p style="margin:28px 0 0;color:#4F6A62;font-size:13px;line-height:20px;">You get one email until you open your messages. To stop these emails, turn off message emails on your profile, or reply STOP in your messages.</p>
  </td></tr></table>
</body></html>`;
  return { subject, html, text };
}
