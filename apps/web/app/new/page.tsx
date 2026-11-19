import { CommonsWordmark } from "@commons/ui";
import Link from "next/link";
import { AccountMenu } from "@/components/account-menu";
import {
  getCommonsDataMode,
  getCurrentAccountInitials,
  getCurrentCommonsIdentity,
} from "@/lib/server/commons";
import {
  getEventCreationPageAccess,
  loadAuthenticatedEventDraft,
  loadRecentEventsForCreation,
} from "@/lib/server/event-creation";
import { EventCreationFlow } from "./event-creation-flow";
import { DEFAULT_PLAN_TEMPLATE_KEY, knownPlanTemplateKey } from "@commons/domain";
import { parseTripEntryContext, tripEntryPath } from "@/lib/trip-entry/context";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await getCurrentCommonsIdentity();
  const query = await searchParams;
  const access = await getEventCreationPageAccess();
  const draftId = typeof query.draft === "string" ? query.draft : null;
  let draftLoadFailed = false;
  const [recentEvents, initialDraft] = access.signedIn
    ? await Promise.all([
      loadRecentEventsForCreation().catch(() => []),
      draftId ? loadAuthenticatedEventDraft(draftId).catch(() => { draftLoadFailed = true; return null; }) : Promise.resolve(null),
    ])
    : [[], null];
  const entryContext = parseTripEntryContext(query);
  const initials = await getCurrentAccountInitials(identity);

  return (
    <main className="creation-shell event-creation-shell">
      <header className="creation-header">
        <Link className="entry-brand" href="/">
          <CommonsWordmark />
        </Link>
        <div className="event-creation-nav">
          {identity ? <Link href="/trips">Your trips</Link> : <Link href={`/sign-in?${new URLSearchParams({ next: tripEntryPath(entryContext, draftId) })}`}>Sign in</Link>}
          <AccountMenu initials={initials} canSignOut={getCommonsDataMode() === "database" && Boolean(identity)} />
        </div>
      </header>
      <div className="event-creation-content">
        <EventCreationFlow
          signedIn={access.signedIn}
          initialRecentEvents={recentEvents}
          initialDraft={initialDraft}
          initialTemplateKey={knownPlanTemplateKey(query.template) ?? DEFAULT_PLAN_TEMPLATE_KEY}
          entry={{ entryContext, requestedDraftId: draftId, draftLoadFailed }}
        />
      </div>
    </main>
  );
}
