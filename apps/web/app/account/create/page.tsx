import { CommonsWordmark } from "@commons/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { safeAuthNext } from "@/lib/auth-flow";
import { getCurrentCommonsIdentity } from "@/lib/server/commons";
import { AccountNameForm } from "./account-name-form";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function CreateAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: requestedNext } = await searchParams;
  const next = safeAuthNext(requestedNext);
  const identity = await getCurrentCommonsIdentity();
  if (!identity) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (identity.displayName?.trim()) redirect(next);

  return (
    <main className="entry-shell">
      <section className="entry-card">
        <Link className="entry-brand" href="/">
          <CommonsWordmark />
        </Link>
        <div className="entry-copy">
          <span className="view-kicker">Create account</span>
          <h1>What should we call you?</h1>
          <p>Add the first name people will see in events you join.</p>
        </div>
        <AccountNameForm next={next} />
      </section>
    </main>
  );
}
