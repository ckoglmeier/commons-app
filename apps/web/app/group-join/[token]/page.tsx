import Link from "next/link";
import { CommonsWordmark } from "@commons/ui";
import { publicGroupInvitationPreview, verifiedGroupInvitationIdentity } from "@/lib/server/group-invitations";
import { redirect } from "next/navigation";
import { accountCreationPath } from "@/lib/auth-flow";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { SignInForm } from "@/app/sign-in/sign-in-form";
import { groupInvitationPath } from "@/lib/group-invitation";
import { textMessagingAvailable, webMessagesEnabledFor } from "@/lib/server/runtime-environment";
import { JoinGroupAction } from "./join-group-action";
export const dynamic = "force-dynamic";
export const metadata = { title: "Join a trip", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function GroupJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params, preview = await publicGroupInvitationPreview(token);
  const identity = preview && isSupabaseAuthConfigured() ? await verifiedGroupInvitationIdentity().catch(() => null) : null;
  if (identity && !identity.displayName) redirect(accountCreationPath(groupInvitationPath(token), "invited"));
  return <main className="entry-shell join-shell" data-analytics-exclude="true"><section className="entry-card join-card">
    <Link className="entry-brand" href="/"><CommonsWordmark /></Link>
    {preview ? <><div className="entry-copy"><span className="view-kicker">Invited by {preview.inviterName}</span><h1>{preview.tripName}</h1>
      <p>Join as a traveler to see the trip and take part. Joining doesn’t confirm attendance, add expense shares or book anything.</p></div>
      <p className="entry-footnote">This group invitation expires {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(preview.expiresAt))} UTC.</p>
      {identity ? <><p>Joining as {identity.displayName || identity.email || "your signed-in account"}.</p><JoinGroupAction token={token} preview={preview} textMessagingOffered={textMessagingAvailable() || webMessagesEnabledFor(identity.email)} /></>
        : <><p>Sign in or create an account, then choose Join the trip.</p><SignInForm next={groupInvitationPath(token)} intent="invited" enabled={isSupabaseAuthConfigured()} /></>}
    </> : <><div className="entry-copy"><h1>This group invitation isn’t available.</h1><p>It may have expired, been replaced or been disabled. Ask the organizer for a current link. If you already joined, your trip access is separate.</p></div><Link className="sheet-secondary" href="/trips/">Open your trips</Link></>}
  </section></main>;
}
