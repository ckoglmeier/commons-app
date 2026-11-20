import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CommonsWordmark } from "@commons/ui";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons-access-errors";
import { readWebThread } from "@/lib/server/messaging/web-thread";
import { commonsSiteOrigin } from "@/lib/server/runtime-environment";
import { WebThread } from "./web-thread";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages — Commons", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/** A person's own conversation with Commons, across the trips they turned it on for. Nobody else sees it. */
export default async function MessagesPage() {
  let thread: Awaited<ReturnType<typeof readWebThread>>;
  try { thread = await readWebThread(); }
  catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) redirect("/sign-in?next=%2Fmessages");
    if (error instanceof CommonsMembershipRequiredError) notFound();
    throw error;
  }
  // Only Commons's links to this site become links. Without a configured origin every message stays plain text.
  let siteOrigin: string | null = null;
  try { siteOrigin = commonsSiteOrigin(); } catch { siteOrigin = null; }
  return (
    <main className="entry-shell" data-analytics-exclude="true">
      <section className="entry-card message-thread-card" aria-labelledby="messages-title">
        <Link className="entry-brand" href="/"><CommonsWordmark /></Link>
        <div className="entry-copy">
          <h1 id="messages-title">Messages</h1>
          <p>Your conversation with Commons, an automated assistant. Answer its questions, ask about the saved plan, or tell it what you paid. Only you see this, and nothing is saved until you approve it.</p>
        </div>
        <WebThread initial={thread} siteOrigin={siteOrigin} />
        <Link className="sheet-secondary" href="/trips/">Your trips</Link>
      </section>
    </main>
  );
}
