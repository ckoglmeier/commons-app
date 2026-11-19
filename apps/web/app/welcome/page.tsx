import { CommonsWordmark } from "@commons/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileOriginForm } from "@/components/profile-origin-form";
import { getCurrentCommonsIdentity } from "@/lib/server/commons";
import { loadAuthenticatedTravelerProfile } from "@/lib/server/profile";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const identity = await getCurrentCommonsIdentity();
  if (!identity) redirect("/sign-in?next=%2Fwelcome");
  const profile = await loadAuthenticatedTravelerProfile();
  return (
    <main className="welcome-shell">
      <header><Link href="/"><CommonsWordmark /></Link></header>
      <section className="welcome-hero">
        <span className="view-kicker">Welcome, {profile.displayName.split(/\s+/)[0]}</span>
        <h1>What are you planning?</h1>
        <div><Link href="/new">Start a trip</Link><Link href="/trips">Open your trips</Link></div>
      </section>
      <ProfileOriginForm initialValue={profile.usualOriginLabel} />
    </main>
  );
}
