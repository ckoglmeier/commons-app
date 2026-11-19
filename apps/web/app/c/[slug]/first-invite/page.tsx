import { betaReworkEnabled } from "@/lib/beta/flags";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CommonsWordmark } from "@commons/ui";
import { commonsPath } from "@/lib/commons-route";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons-access-errors";
import { loadTripActivationStatus } from "@/lib/server/trip-activation";
import { FirstInviteRoute } from "./first-invite-route";

export const dynamic = "force-dynamic";

/** The reusable entry into the first-invite flow. Link here from anywhere that needs it; it owns no trip layout. */
export default async function FirstInvitePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ checkout?: string | string[]; for?: string | string[] }> }) {
  if (!betaReworkEnabled()) notFound();
  const { slug } = await params, query = await searchParams;
  let status;
  try { status = await loadTripActivationStatus({ trip: slug }); }
  catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) redirect(`/sign-in?${new URLSearchParams({ next: `/c/${slug}/first-invite` })}`);
    if (error instanceof CommonsMembershipRequiredError) notFound();
    throw error;
  }
  if (!status) notFound();
  if (!status.draftId || !status.tripId) redirect(`${commonsPath(slug)}?arrival=0`);
  const checkout = query.checkout === "returned" || query.checkout === "cancelled" ? query.checkout : null;
  return <main className="creation-shell event-creation-shell">
    <header className="creation-header"><Link className="entry-brand" href="/"><CommonsWordmark /></Link><div className="event-creation-nav"><Link href={`${commonsPath(status.tripId)}?arrival=0`}>Back to trip</Link></div></header>
    <div className="event-creation-content"><div className="event-draft-card setup-panel">
      <FirstInviteRoute draftId={status.draftId} tripId={status.tripId} slug={slug} people={[...status.unsentInvitees, ...status.savedPeople.filter(person => person.hasEmail).map(person => person.name)]} peopleWithoutEmail={status.savedPeople.filter(person => !person.hasEmail).map(person => person.name)} checkout={checkout} forHelp={query.for === "help"} />
    </div></div>
  </main>;
}
