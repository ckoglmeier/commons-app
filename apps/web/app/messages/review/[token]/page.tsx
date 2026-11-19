import Link from "next/link";
import { CommonsWordmark } from "@commons/ui";
import { SignInForm } from "@/app/sign-in/sign-in-form";
import { CommonsAuthenticationRequiredError } from "@/lib/server/commons-access-errors";
import { readReview } from "@/lib/server/messaging/web";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { ReviewActions } from "./review-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Check a booking", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/*
 * The secure page behind "text us your booking": review what Commons read, add or replace details, then save or discard. The address is not a
 * credential; the signed-in person must own the review. Nothing here is saved until Save is chosen for the exact version shown.
 */
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let view: Awaited<ReturnType<typeof readReview>> = null, signedOut = false;
  try { view = await readReview(token); } catch (error) { if (error instanceof CommonsAuthenticationRequiredError) signedOut = true; else throw error; }
  return (
    <main className="entry-shell" data-analytics-exclude="true">
      <section className="entry-card" aria-labelledby="review-title">
        <Link className="entry-brand" href="/"><CommonsWordmark /></Link>
        {signedOut ? <>
          <div className="entry-copy"><span className="view-kicker">Booking review</span><h1 id="review-title">Sign in to check your booking</h1>
            <p>This page is private to the person who sent the booking. Sign in with the account you use for the trip.</p></div>
          <SignInForm next={`/messages/review/${token}`} intent="sign-in" enabled={isSupabaseAuthConfigured()} />
        </> : !view ? <>
          <div className="entry-copy"><h1 id="review-title">This review isn’t available</h1>
            <p>The link may have expired, or it belongs to someone else’s account. Text Commons your booking again to get a new one.</p></div>
          <Link className="sheet-secondary" href="/trips/">Open your trips</Link>
        </> : <ReviewActions token={token} view={view} />}
      </section>
    </main>
  );
}
