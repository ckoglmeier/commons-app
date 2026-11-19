import { emailBrandHtml } from "./brand";
import type { RenderedEmail } from "./invitation-email";

export type AuthenticationEmailIntent = "sign-in" | "create" | "invited" | "access";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeHttpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Authentication links must use HTTP or HTTPS.");
  }
  return url.toString();
}

export function renderCommonsAuthenticationEmail(input: {
  email: string;
  signInUrl: string;
  intent: AuthenticationEmailIntent;
}): RenderedEmail {
  const signInUrl = escapeHtml(safeHttpUrl(input.signInUrl));
  const email = escapeHtml(input.email.trim().toLowerCase());
  const creating = input.intent === "create";
  const invited = input.intent === "invited";
  const requestingAccess = input.intent === "access";
  const subject = requestingAccess ? "Continue your Commons beta request" : creating ? "Finish creating your Commons account" : invited ? "Continue to your event on Commons" : "Your Commons sign-in link";
  const kicker = requestingAccess ? "Commons beta" : creating ? "New account" : invited ? "Event invitation" : "Sign in to Commons";
  const heading = requestingAccess ? "Request beta access." : creating ? "Your events start here." : invited ? "Your event is waiting." : "Pick up where you left off.";
  const body = requestingAccess
    ? "Use this private link to create your account and request access to the Commons beta."
    : creating
    ? "Use this private link to finish creating your account."
    : invited
      ? "Use this private link to sign in, then continue directly to your invitation."
      : "Use this private link to sign in. No password needed.";
  const action = requestingAccess ? "Continue request" : creating ? "Create account" : invited ? "Continue to your event" : "Sign in to Commons";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title>
<style>@media only screen and (max-width:620px){.email-shell{width:100%!important}.email-card{border-radius:20px!important}.email-pad{padding-left:24px!important;padding-right:24px!important}.email-title{font-size:38px!important;line-height:40px!important}.primary-link{display:block!important;text-align:center!important}}</style></head>
<body style="margin:0;padding:0;background:#FFFFFF;color:#16372F;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">A private, one-time link for ${email}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFFFFF;"><tr><td align="center" style="padding:32px 12px;">
<table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;">
<tr><td style="padding:0 8px 18px;">${emailBrandHtml}</td></tr>
<tr><td class="email-card" style="overflow:hidden;border:1px solid #DCE4E0;border-radius:24px;background:#FFFFFF;box-shadow:0 14px 36px rgba(22,55,47,.10);">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td class="email-pad" style="padding:42px 44px 18px;">
<p style="margin:0 0 18px;color:#2E6758;font-size:12px;font-weight:700;line-height:17px;letter-spacing:.09em;text-transform:uppercase;">${escapeHtml(kicker)}</p>
<h1 class="email-title" style="margin:0;color:#16372F;font-family:Arial,Helvetica,sans-serif;font-size:48px;font-weight:400;line-height:50px;letter-spacing:-.035em;">${escapeHtml(heading)}</h1>
</td></tr><tr><td class="email-pad" style="padding:0 44px 42px;"><p style="margin:0 0 24px;color:#5E6C67;font-size:15px;line-height:24px;">${escapeHtml(body)}</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:14px;background:#16372F;"><a class="primary-link" href="${signInUrl}" style="display:inline-block;padding:15px 22px;color:#FFFFFF;font-size:15px;font-weight:700;line-height:18px;text-decoration:none;">${escapeHtml(action)}</a></td></tr></table>
<p style="margin:24px 0 0;color:#5E6C67;font-size:12px;line-height:19px;">This one-time link is for ${email}. If you didn’t request it, you can ignore this email.</p>
</td></tr></table></td></tr></table></td></tr></table></body></html>`;

  return {
    subject,
    html,
    text: `${heading}\n\n${body}\n\n${action}: ${safeHttpUrl(input.signInUrl)}\n\nThis one-time link is for ${input.email.trim().toLowerCase()}. If you didn’t request it, you can ignore this email.`,
  };
}
