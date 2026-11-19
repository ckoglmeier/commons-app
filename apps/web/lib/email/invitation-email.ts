import { emailBrandHtml } from "./brand";
export type CommonsInvitationEmailInput = {
  recipientName?: string;
  recipientEmail: string;
  inviterName?: string;
  tripName: string;
  tripDates: string;
  tripLocation: string;
  tripUrl: string;
  personalMessage?: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

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
    throw new Error("Invitation links must use HTTP or HTTPS.");
  }
  return url.toString();
}

export function renderCommonsInvitationEmail(
  input: CommonsInvitationEmailInput,
): RenderedEmail {
  const tripUrl = escapeHtml(safeHttpUrl(input.tripUrl));
  const tripName = escapeHtml(input.tripName.trim());
  const tripDates = escapeHtml(input.tripDates.trim());
  const tripLocation = escapeHtml(input.tripLocation.trim());
  const recipientEmail = escapeHtml(input.recipientEmail.trim().toLowerCase());
  const recipientName = input.recipientName?.trim()
    ? escapeHtml(input.recipientName.trim())
    : null;
  const inviterName = input.inviterName?.trim()
    ? escapeHtml(input.inviterName.trim())
    : null;
  const personalMessage = input.personalMessage?.trim()
    ? escapeHtml(input.personalMessage.trim()).replaceAll("\n", "<br>")
    : null;
  const greeting = recipientName ? `Hi ${recipientName},` : "You’re invited.";
  const invitationLine = inviterName
    ? `${inviterName} invited you to join the trip on Commons.`
    : "The group invited you to join the trip on Commons.";
  const subject = input.inviterName?.trim()
    ? `${input.inviterName.trim()} invited you to ${input.tripName.trim()}`
    : `You’re invited to ${input.tripName.trim()}`;
  const preheader = `${input.tripDates.trim()} · ${input.tripLocation.trim()}`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(subject)}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .email-shell { width: 100% !important; }
        .email-card { border-radius: 20px !important; }
        .email-pad { padding-left: 24px !important; padding-right: 24px !important; }
        .trip-title { font-size: 38px !important; line-height: 40px !important; }
        .primary-link { display: block !important; text-align: center !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#FFFFFF;color:#16372F;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFFFFF;">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;">
            <tr>
              <td style="padding:0 8px 18px;">
                ${emailBrandHtml}
              </td>
            </tr>
            <tr>
              <td class="email-card" style="overflow:hidden;border:1px solid #DCE4E0;border-radius:24px;background:#FFFFFF;box-shadow:0 14px 36px rgba(22,55,47,.10);">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td class="email-pad" style="padding:42px 44px 26px;">
                      <p style="margin:0 0 18px;color:#2E6758;font-size:12px;font-weight:700;line-height:17px;letter-spacing:.09em;text-transform:uppercase;">Trip invitation</p>
                      <p style="margin:0 0 12px;color:#5E6C67;font-size:15px;line-height:23px;">${greeting}</p>
                      <h1 class="trip-title" style="margin:0;color:#16372F;font-family:Arial,Helvetica,sans-serif;font-size:48px;font-weight:400;line-height:50px;letter-spacing:-.035em;">${tripName}</h1>
                    </td>
                  </tr>
                  <tr>
                    <td class="email-pad" style="padding:0 44px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-radius:16px;background:#E4ECE8;">
                        <tr>
                          <td style="padding:20px 22px;">
                            <p style="margin:0 0 5px;color:#16372F;font-size:16px;font-weight:700;line-height:23px;">${tripDates}</p>
                            <p style="margin:0;color:#5E6C67;font-size:14px;line-height:21px;">${tripLocation}</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td class="email-pad" style="padding:28px 44px 42px;">
                      <p style="margin:0 0 8px;color:#16372F;font-size:16px;line-height:25px;">${invitationLine}</p>
                      ${personalMessage ? `<div style="margin:18px 0 22px;padding:18px 20px;border-left:3px solid #2E6758;border-radius:0 12px 12px 0;background:#FFFFFF;color:#16372F;font-size:15px;line-height:24px;">${personalMessage}</div>` : ""}
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="border-radius:14px;background:#16372F;">
                            <a class="primary-link" href="${tripUrl}" style="display:inline-block;padding:15px 22px;color:#FFFFFF;font-size:15px;font-weight:700;line-height:18px;text-decoration:none;">Open ${tripName}</a>
                          </td>
                        </tr>
                      </table>
                      <p style="margin:24px 0 0;color:#5E6C67;font-size:12px;line-height:19px;">This private link signs in ${recipientEmail}. Don’t forward it. If it expires, your invitation stays available.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${greeting}

${input.tripName.trim()}
${input.tripDates.trim()} · ${input.tripLocation.trim()}

${input.inviterName?.trim() ? `${input.inviterName.trim()} invited you to join the trip on Commons.` : "The group invited you to join the trip on Commons."}

${input.personalMessage?.trim() ? `${input.personalMessage.trim()}\n` : ""}

Open ${input.tripName.trim()}: ${safeHttpUrl(input.tripUrl)}

This private link signs in ${input.recipientEmail.trim().toLowerCase()}. Don’t forward it. If it expires, your invitation stays available.`;

  return { subject, html, text };
}
