import { emailBrandHtml } from "./brand";

export function renderBetaOrganizerEmail(origin: string, message = "") {
  const note = message.trim();
  const escapedNote = note.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const personalHtml = note ? `<p style="font-size:16px;line-height:1.6;white-space:pre-wrap">${escapedNote}</p>` : "";
  const url = new URL("/sign-in?intent=create&next=%2Fnew", origin);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid site URL.");
  const href = url.toString().replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return {
    subject: "You’re invited to the Commons beta",
    text: `You’re invited to try Commons.\n\n${note ? `${note}\n\n` : ""}You can now create your own trips.\n\nGet started: ${url}\n\nSign in with the email this invitation was sent to. This invitation doesn’t add you to a trip.`,
    html: `<!doctype html><html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;color:#16372F;background:#FFFFFF;padding:24px"><main style="max-width:560px;margin:auto">${emailBrandHtml}<h1 style="font-size:28px;font-weight:500">You’re invited to try Commons.</h1>${personalHtml}<p style="font-size:16px;line-height:1.6">You can now create your own trips.</p><p><a href="${href}" style="display:inline-block;padding:16px 24px;background:#16372F;color:#FFFFFF;border-radius:12px;text-decoration:none">Get started</a></p><p style="font-size:14px;line-height:1.6">Sign in with the email this invitation was sent to. This invitation doesn’t add you to a trip.</p></main></body></html>`,
  };
}
