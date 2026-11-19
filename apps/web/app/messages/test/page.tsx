import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CommonsWordmark } from "@commons/ui";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons-access-errors";
import { readTestThread } from "@/lib/server/messaging/test-thread";
import { TestThread } from "./test-thread";

export const dynamic = "force-dynamic";
export const metadata = { title: "Test messages", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/** Tries the text conversation without a phone. Only listed accounts see it, and it says plainly what's real and what isn't. */
export default async function TestMessagesPage() {
  let thread: Awaited<ReturnType<typeof readTestThread>>;
  try { thread = await readTestThread(); }
  catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) redirect("/sign-in?next=%2Fmessages%2Ftest");
    if (error instanceof CommonsMembershipRequiredError) notFound();
    throw error;
  }
  return (
    <main className="entry-shell" data-analytics-exclude="true">
      <section className="entry-card message-thread-card" aria-labelledby="test-thread-title">
        <Link className="entry-brand" href="/"><CommonsWordmark /></Link>
        <div className="entry-copy">
          <span className="view-kicker">Test</span>
          <h1 id="test-thread-title">Test messages</h1>
          <p>This stands in for texting with Commons. Nothing is sent to a phone, but your answers are real: they change your actual trips, just as a text would.</p>
        </div>
        <TestThread initial={thread} />
      </section>
    </main>
  );
}
