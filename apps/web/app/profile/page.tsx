import { CommonsWordmark } from "@commons/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileContactMethods } from "@/components/profile-contact-methods";
import { ProfileMobile } from "@/components/profile-mobile";
import { TravelerPreferencesForm } from "@/components/traveler-preferences-form";
import { ProfileMessageEmails } from "@/components/profile-message-emails";
import { currentPersonIsInstanceAdmin } from "@/lib/server/instance-access";
import { getCurrentCommonsIdentity } from "@/lib/server/commons";
import { ownVerifiedPhone } from "@/lib/server/messaging/phone-verification";
import { loadAuthenticatedTravelerProfile } from "@/lib/server/profile";
import { textMessagingAvailable } from "@/lib/server/runtime-environment";
import { currentSignInMethod } from "@/lib/server/sign-in-method";
import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your profile — Commons" };

export default async function ProfilePage() {
  const identity = await getCurrentCommonsIdentity();
  if (!identity) redirect("/sign-in?next=%2Fprofile");
  const profile = await loadAuthenticatedTravelerProfile();
  const phoneAvailable = textMessagingAvailable();
  const instanceAdmin = await currentPersonIsInstanceAdmin();
  const passwords = await currentSignInMethod() === "password";
  return (
    <main className="profile-shell">
      <header><Link href="/"><CommonsWordmark /></Link><Link href="/trips">Done</Link></header>
      <section className="profile-heading"><span className="view-kicker">Private to you</span><h1>Your profile.</h1><p>Commons can reuse these on future trips, with your confirmation.</p></section>
      <ProfileContactMethods email={profile.email} passwordSignIn={passwords} />
      {phoneAvailable ? <ProfileMobile phone={await ownVerifiedPhone()} /> : null}
      {passwords ? <ChangePasswordForm /> : <ProfileMessageEmails initialEnabled={profile.dailyDigestEnabled} />}
      {instanceAdmin ? (
        <section className="profile-notifications" aria-labelledby="profile-instance-heading">
          <span className="view-kicker">You run this Commons</span>
          <h2 id="profile-instance-heading">Who can join</h2>
          <p>Choose who can create an account here. Invited travelers can always join.</p>
          <Link className="cm-action" href="/settings/join">Who can join</Link>
        </section>
      ) : null}
      <TravelerPreferencesForm profile={profile} endpoint="/api/v1/profile" />
    </main>
  );
}
