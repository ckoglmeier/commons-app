import { CommonsWordmark } from "@commons/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentCommonsIdentity } from "@/lib/server/commons";
import { loadJoinSettings } from "@/lib/server/instance-access";
import { JoinSettingsForm } from "./join-settings-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Who can join — Commons", robots: { index: false, follow: false } };

/** The instance admin chooses who may create an account on this copy. Everyone else gets a not-found. */
export default async function JoinSettingsPage() {
  const identity = await getCurrentCommonsIdentity();
  if (!identity) redirect("/sign-in?next=%2Fsettings%2Fjoin");
  const settings = await loadJoinSettings().catch(() => null);
  if (!settings?.isAdmin) notFound();
  return (
    <main className="profile-shell">
      <header><Link href="/"><CommonsWordmark /></Link><Link href="/profile">Done</Link></header>
      <section className="profile-heading">
        <span className="view-kicker">You run this Commons</span>
        <h1>Who can join.</h1>
        <p>Choose who can create an account here. People you invite to a trip can always join, whatever you choose.</p>
      </section>
      <JoinSettingsForm initialMode={settings.signupMode} initialDomains={settings.allowedDomains} />
    </main>
  );
}
