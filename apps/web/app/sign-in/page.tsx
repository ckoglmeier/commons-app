import { CommonsWordmark } from "@commons/ui";
import Link from "next/link";
import { currentSignInMethod } from "@/lib/server/sign-in-method";
import { EntryForm } from "./entry-form";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; intent?: string }>;
}) {
  const { next = "/", error, intent } = await searchParams;
  const method = await currentSignInMethod();
  const devSignIn = method === "test";
  const enabled = method !== "off";
  const invited = intent === "invited";
  const creating = intent === "create";

  return (
    <main className="entry-shell">
      <section className="entry-card">
        <Link className="entry-brand" href="/">
          <CommonsWordmark />
        </Link>
        <div className="entry-copy">
          <span className="view-kicker">{creating ? "Create account" : invited ? "Event invitation" : "Sign in"}</span>
          <h1>{creating ? "Start a trip." : invited ? "Welcome to your trip." : "Sign in to Commons."}</h1>
          <p>{devSignIn ? "Local test sign-in: enter any made-up email. No email is sent, and this only works on your own computer." : method === "password" ? (invited ? "Create an account with your email and a password to continue to your invitation." : "Use your email and password.") : invited ? "Use your email to continue to your invitation." : "Use your email. We’ll send a one-time sign-in link."}</p>
        </div>
        {error === "confirmation_failed" ? <p className="auth-message auth-message--error" role="alert">That link expired or was already used. Request another.</p> : null}
        <EntryForm next={next} intent={creating ? "create" : invited ? "invited" : "sign-in"} />
        {!enabled ? (
          <div className="entry-preview-note">
            <strong>Sign-in isn’t set up yet</strong>
            <p>Whoever runs this copy of Commons needs to add the Supabase settings.</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
