import { CommonsWordmark } from "@commons/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentCommonsIdentity } from "@/lib/server/commons";
import { loadJoinSettings } from "@/lib/server/instance-access";
import { currentSignInMethod } from "@/lib/server/sign-in-method";
import { JoinSettingsForm } from "./join-settings-form";
import { ResetPasswordForm } from "./reset-password-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Who can join — Commons", robots: { index: false, follow: false } };

/** The instance admin chooses who may create an account on this copy. Everyone else gets a not-found. */
export default async function JoinSettingsPage() {
  const identity = await getCurrentCommonsIdentity();
  if (!identity) redirect("/sign-in?next=%2Fsettings%2Fjoin");
  const settings = await loadJoinSettings().catch(() => null);
  if (!settings?.isAdmin) notFound();
  const passwords = await currentSignInMethod() === "password";
  return (
    <main className="profile-shell">
      <header><Link href="/"><CommonsWordmark /></Link><Link href="/profile">Done</Link></header>
      <section className="profile-heading">
        <span className="view-kicker">You run this Commons</span>
        <h1>Who can join.</h1>
        <p>Choose who can create an account here. People you invite to a trip can always join, whatever you choose.</p>
        {passwords ? <p>This Commons has no email set up, so people sign in with a password. Invite people by sharing a trip’s invite link. Email domain rules can’t confirm that someone owns an address, so they only check what people type.</p> : null}
      </section>
      <JoinSettingsForm initialMode={settings.signupMode} initialDomains={settings.allowedDomains} />
      {passwords ? <ResetPasswordForm /> : null}
    </main>
  );
}
