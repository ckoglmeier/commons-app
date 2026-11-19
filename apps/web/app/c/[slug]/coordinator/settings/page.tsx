import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CommonsWordmark } from '@commons/ui';
import { CommandAccessError } from '@commons/database';
import { authenticatedCoordinatorPreferences } from '@/lib/server/polls';
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from '@/lib/server/commons';
import { coordinatorPersonalitiesEnabled } from '@/lib/server/runtime-environment';
import { TripCoordinatorSettings } from '@/components/trip-coordinator-settings';
import { heldFeaturePath, tripCapabilitiesFor } from '@/lib/server/trip-capabilities';
import '@/components/coordinator-review.css';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: {
    params: Promise<{
        slug: string;
    }>;
}) {
    const { slug } = await params;
    // Beta trips have no personalities (BR-03); saved preferences stay stored.
    if ((await tripCapabilitiesFor(slug)).tier === 'beta')
        redirect(heldFeaturePath(slug));
    if (!coordinatorPersonalitiesEnabled())
        notFound();
    let preferences;
    try {
        preferences = await authenticatedCoordinatorPreferences(slug);
    }
    catch (error) {
        if (error instanceof CommonsAuthenticationRequiredError)
            redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/coordinator/settings/`)}`);
        if (error instanceof CommonsMembershipRequiredError || error instanceof CommandAccessError)
            notFound();
        throw error;
    }
    return <main className="creation-shell"><header className="creation-header"><Link href="/trips"><CommonsWordmark /></Link><Link href={`/c/${slug}/coordinator/`}>Back to Workspace</Link></header><div className="event-creation-content"><section className="event-entry-card"><span className="view-kicker">{preferences.tripContext.name}</span><h1>Trip settings</h1><div className="setup-coordinator"><h2>Your coordinator</h2><p>Choose the planning style for this trip. All active organizers share this choice. Earlier replies and decisions stay unchanged.</p><div className="setup-coordinator-actions"><TripCoordinatorSettings slug={slug} initial={preferences.settings}/></div></div></section></div></main>;
}
