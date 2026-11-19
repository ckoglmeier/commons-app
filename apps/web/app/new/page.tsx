import { CommonsWordmark } from "@commons/ui";
import Link from "next/link";
import { AccountMenu } from "@/components/account-menu";
import {
  getCommonsDataMode,
  getCurrentAccountInitials,
  getCurrentCommonsIdentity,
} from "@/lib/server/commons";
import {
  currentAccountHasPilotCapabilities,
  getEventCreationPageAccess,
  loadAuthenticatedEventDraft,
  loadRecentEventsForCreation,
  requestAuthenticatedEventCreationAccess,
} from "@/lib/server/event-creation";
import { EventCreationFlow } from "./event-creation-flow";
import { readCommonsRuntimeEnvironment, coordinatorPersonalitiesEnabled } from "@/lib/server/runtime-environment";
import { isCommonsOperatorEmail } from "@/lib/server/operator";
import { redirect } from "next/navigation";
import { betaReworkEnabled } from "@/lib/beta/flags";
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
  let access = await getEventCreationPageAccess();
  let accessRequestedFromHomepage = false;
  if (identity && query.access === "request" && !access.allowed && access.status !== "requested") {
    try {
      const request = await requestAuthenticatedEventCreationAccess();
      access = { signedIn: true, allowed: false, status: request.status };
      accessRequestedFromHomepage = true;
    } catch {
      // Keep the request action available so the person can retry without losing the page.
    }
  }
  const draftId = typeof query.draft === "string" ? query.draft : null;
  const activationOn = betaReworkEnabled();
  let draftLoadFailed = false;
  const [recentEvents, initialDraft] = access.allowed
    ? await Promise.all([
      loadRecentEventsForCreation().catch(() => []),
      draftId ? loadAuthenticatedEventDraft(draftId).catch(() => { draftLoadFailed = activationOn; return null; }) : Promise.resolve(null),
    ])
    : [[], null];
  const checkout = query.checkout === "returned" || query.checkout === "cancelled" ? query.checkout : null;
  // Once a flagged draft is a trip, its one home for inviting is the trip's first-invite flow. The checkout return address is shared.
  if (activationOn && initialDraft?.betaActivationRequired && initialDraft.committedEventId) redirect(`/c/${initialDraft.committedEventId}/first-invite${checkout ? `?checkout=${checkout}` : ""}`);
  const entryContext = activationOn ? parseTripEntryContext(query) : {};
  const initials = await getCurrentAccountInitials(identity);
  const coordinatorEnabled = readCommonsRuntimeEnvironment().COMMONS_COORDINATOR_ONBOARDING_ENABLED === "true"
    && access.allowed && await currentAccountHasPilotCapabilities().catch(() => false);

  return (
    <main className="creation-shell event-creation-shell">
      <header className="creation-header">
        <Link className="entry-brand" href="/">
          <CommonsWordmark />
        </Link>
        <div className="event-creation-nav">
          {identity ? <Link href="/trips">Your trips</Link> : <Link href={activationOn ? `/sign-in?${new URLSearchParams({ next: tripEntryPath(entryContext, draftId) })}` : "/sign-in?next=%2Fnew"}>Sign in</Link>}
          <AccountMenu initials={initials} canSignOut={getCommonsDataMode() === "database" && Boolean(identity)} operator={isCommonsOperatorEmail(identity?.email)} />
        </div>
      </header>
      <div className="event-creation-content">
        <EventCreationFlow
          coordinatorEnabled={coordinatorEnabled}
          personalitiesEnabled={coordinatorPersonalitiesEnabled()}
          signedIn={access.signedIn}
          allowed={access.allowed}
          accessStatus={access.status}
          accessRequestedFromHomepage={accessRequestedFromHomepage}
          initialRecentEvents={recentEvents}
          initialDraft={initialDraft}
          activation={activationOn ? { entryContext, requestedDraftId: draftId, draftLoadFailed, checkout } : null}
        />
      </div>
    </main>
  );
}
