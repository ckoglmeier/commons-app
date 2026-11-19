import { CommonsWordmark } from "@commons/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { safeAuthNext } from "@/lib/auth-flow";
import { getCurrentCommonsIdentity } from "@/lib/server/commons";
import { ownVerifiedPhone } from "@/lib/server/messaging/phone-verification";
import { textMessagingAvailable } from "@/lib/server/runtime-environment";
import { AccountPhoneForm } from "./account-phone-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add your mobile number", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/** Optional, and never in the way of an invitation. Confirming a number here turns on nothing: texts are chosen per trip. */
export default async function AccountPhonePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeAuthNext((await searchParams).next);
  // Real numbers only. In test mode nobody is asked for a phone here: the fictional number is set up on the test page.
  if (!textMessagingAvailable()) redirect(next);
  const identity = await getCurrentCommonsIdentity();
  if (!identity) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (await ownVerifiedPhone()) redirect(next);
  return (
    <main className="entry-shell" data-analytics-exclude="true">
      <section className="entry-card" aria-labelledby="account-phone-title">
        <Link className="entry-brand" href="/"><CommonsWordmark /></Link>
        <div className="entry-copy">
          <span className="view-kicker">Optional</span>
          <h1 id="account-phone-title">Add your mobile number?</h1>
          <p>You’ll be able to answer trip questions and send in bookings by text. Adding it doesn’t turn on texts. You choose that for each trip.</p>
        </div>
        <AccountPhoneForm next={next} />
        <p className="entry-footnote"><Link href={next}>Skip for now</Link></p>
      </section>
    </main>
  );
}
