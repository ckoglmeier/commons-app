import { renderCommonsInvitationEmail } from "@/lib/email/invitation-email";
import { commonsPath, PUBLIC_DEMO_COMMONS_ID } from "@/lib/commons-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const email = renderCommonsInvitationEmail({
    recipientName: "Taylor",
    recipientEmail: "taylor@example.com",
    inviterName: "Casey",
    tripName: "Desert Weekend",
    tripDates: "October 9–12, 2027",
    tripLocation: "Santa Fe, New Mexico",
    tripUrl: `${origin}/sign-in?next=${encodeURIComponent(commonsPath(PUBLIC_DEMO_COMMONS_ID))}`,
  });
  return new Response(email.html, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
