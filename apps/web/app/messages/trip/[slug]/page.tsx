import Link from "next/link";
import { redirect } from "next/navigation";
import { CommonsWordmark } from "@commons/ui";
import { SignInForm } from "@/app/sign-in/sign-in-form";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons-access-errors";
import { readEnrollment } from "@/lib/server/messaging/web";
import { readWebMessagesForTrip } from "@/lib/server/messaging/web-thread";
import { textMessagingAvailable } from "@/lib/server/runtime-environment";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { EnrollmentForm } from "./enrollment-form";
import { WebMessagesForm } from "./web-messages-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages from Commons", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/** Optional. The trip works the same on the web whether or not this is turned on. Consent is created here, for one trip, and nowhere else. */
export default async function TextWithCommonsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ joined?: string; channel?: string }> }) {
  const { slug } = await params, { joined, channel } = await searchParams, justJoined = joined === "1";
  // Texting is asked for explicitly, so it wins over Messages in Commons on this page. Nobody is invited to enroll until texts can actually be sent.
  const textChannel = channel === "text" && textMessagingAvailable();
  // Messages in Commons take the place of texting on this page.
  if (!textChannel) return <WebMessagesPage slug={slug} justJoined={justJoined} />;
  let status: Awaited<ReturnType<typeof readEnrollment>> | null = null, signedOut = false;
  try { status = await readEnrollment(slug); }
  catch (error) { if (error instanceof CommonsAuthenticationRequiredError) signedOut = true; else if (!(error instanceof CommonsMembershipRequiredError)) throw error; }
  // Arriving straight from an invitation, someone already enrolled has nothing to decide here.
  if (justJoined && status?.enrolled) redirect(`/c/${slug}/`);
  return (
    <main className="entry-shell" data-analytics-exclude="true">
      <section className="entry-card" aria-labelledby="text-title">
        <Link className="entry-brand" href="/"><CommonsWordmark /></Link>
        {signedOut ? <>
          <div className="entry-copy"><h1 id="text-title">Sign in to turn on texts</h1><p>Texting is optional and you can use the trip on the web without it.</p></div>
          <SignInForm next={`/messages/trip/${slug}`} intent="sign-in" enabled={isSupabaseAuthConfigured()} />
        </> : !status ? <>
          <div className="entry-copy"><h1 id="text-title">This trip isn’t available</h1><p>You need to be a member of the trip to turn on texts for it.</p></div>
          <Link className="sheet-secondary" href="/trips/">Open your trips</Link>
        </> : <>
          <div className="entry-copy"><span className="view-kicker">{status.tripName}</span><h1 id="text-title">{justJoined ? "You’re in. Want to do this by text?" : "Text with Commons"}</h1>
            <p>Answer a few questions and send in bookings by text, instead of opening the app. Your texts to Commons aren’t posted to the group. You review anything before it is shared.</p></div>
          <EnrollmentForm slug={slug} tripName={status.tripName} consentText={status.consentText} enrolled={status.enrolled} optedOut={status.optedOut} verifiedPhone={status.verifiedPhone} />
          <p className="entry-footnote">{justJoined ? <Link href={`/c/${slug}/`}>Not now, go to the trip</Link> : <>Prefer not to text? Nothing changes. {" "}<Link href={`/c/${slug}/`}>Back to the trip</Link></>}</p>
        </>}
      </section>
    </main>
  );
}

async function WebMessagesPage({ slug, justJoined }: { slug: string; justJoined: boolean }) {
  let status: Awaited<ReturnType<typeof readWebMessagesForTrip>> | null = null;
  try { status = await readWebMessagesForTrip(slug); }
  catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) redirect(`/sign-in?next=${encodeURIComponent(`/messages/trip/${slug}`)}`);
    if (!(error instanceof CommonsMembershipRequiredError)) throw error;
  }
  if (justJoined && status?.on) redirect(`/c/${slug}/`);
  return (
    <main className="entry-shell" data-analytics-exclude="true">
      <section className="entry-card" aria-labelledby="messages-trip-title">
        <Link className="entry-brand" href="/"><CommonsWordmark /></Link>
        {!status ? <>
          <div className="entry-copy"><h1 id="messages-trip-title">This trip isn’t available</h1><p>You need to be a member of the trip to turn on messages for it.</p></div>
          <Link className="sheet-secondary" href="/trips/">Open your trips</Link>
        </> : <>
          <div className="entry-copy"><span className="view-kicker">{status.tripName}</span><h1 id="messages-trip-title">{justJoined ? "You’re in. Want Commons to keep you posted?" : "Messages from Commons"}</h1>
            <p>Commons asks one thing at a time, like whether you’re coming or which dinner works, and answers questions about the saved plan. It’s a private conversation in Commons: nothing goes to your phone, and nothing you send is posted to the group.</p></div>
          <WebMessagesForm slug={slug} tripName={status.tripName} consentText={status.consentText} on={status.on} onPhone={status.onPhone} />
          <p className="entry-footnote">{justJoined ? <Link href={`/c/${slug}/`}>Not now, go to the trip</Link> : <>Not for you? Nothing changes. {" "}<Link href={`/c/${slug}/`}>Back to the trip</Link></>}</p>
        </>}
      </section>
    </main>
  );
}
