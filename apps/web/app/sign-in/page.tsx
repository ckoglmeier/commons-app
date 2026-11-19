import { CommonsWordmark } from "@commons/ui";
import Link from "next/link";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { publicFreeBetaEnabled } from "@/lib/server/trip-capabilities";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; intent?: string }>;
}) {
  const { next = "/", error, intent } = await searchParams;
  const enabled = isSupabaseAuthConfigured();
  const invited = intent === "invited";
  const creating = intent === "create";
  const requestingAccess = intent === "access";

  return (
    <main className="entry-shell">
      <section className="entry-card">
        <Link className="entry-brand" href="/">
          <CommonsWordmark />
        </Link>
        <div className="entry-copy">
          <span className="view-kicker">{requestingAccess ? "Commons beta" : creating ? "Create account" : invited ? "Event invitation" : "Sign in"}</span>
          <h1>{requestingAccess ? "Get beta access." : creating ? (publicFreeBetaEnabled() ? "Start a trip." : "Start a trip.") : invited ? "Welcome to your trip." : "Sign in to Commons."}</h1>
          <p>{invited ? "Use your email to continue to your invitation." : "Use your email. We’ll send a one-time sign-in link."}</p>
        </div>
        {error === "confirmation_failed" ? <p className="auth-message auth-message--error" role="alert">That link expired or was already used. Request another.</p> : null}
        <SignInForm next={next} enabled={enabled} intent={requestingAccess ? "access" : creating ? "create" : invited ? "invited" : "sign-in"} />
        {!enabled ? (
          <div className="entry-preview-note">
            <strong>Sign-in unavailable</strong>
            <p>Please try again later.</p>
            <Link href="/support/">Contact support</Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
