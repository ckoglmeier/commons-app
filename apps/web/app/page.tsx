import { MarketingHomeFooter } from '@/lib/marketing/home-footer';
import type { Metadata } from 'next';
import { marketingIndexingEnabled, marketingOrigin, marketingRoutesEnabled } from '@/lib/marketing/route-mode';
import { TripsIndex } from "@/components/trips-index";
import {
  getCommonsDataMode,
  getCurrentAccountInitials,
  getCurrentCommonsIdentity,
  loadPublicCommonsMemberships,
} from "@/lib/server/commons";
import { getEventCreationPageAccess } from "@/lib/server/event-creation";
import { publicFreeBetaEnabled } from "@/lib/server/trip-capabilities";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  if (!marketingRoutesEnabled()) return {};
  return { metadataBase: new URL(marketingOrigin()), alternates: { canonical: '/' }, robots: { index: marketingIndexingEnabled(), follow: marketingIndexingEnabled() } };
}

export default async function Page() {
  const identity = await getCurrentCommonsIdentity();
  const [accountInitials, creationAccess] = await Promise.all([
    getCurrentAccountInitials(identity),
    identity
      ? getEventCreationPageAccess().catch(() => ({ signedIn: true, allowed: false, status: null }))
      : Promise.resolve({ signedIn: false, allowed: false, status: null }),
  ]);
  return (<>
    <TripsIndex
      memberships={loadPublicCommonsMemberships()}
      canSignOut={getCommonsDataMode() === "database" && Boolean(identity)}
      accountInitials={accountInitials}
      signedIn={Boolean(identity)}
      creationAccessAllowed={creationAccess.allowed}
      creationAccessStatus={creationAccess.status}
      publicPage
      publicFreeBeta={publicFreeBetaEnabled()}
      supportInFooter={marketingRoutesEnabled()}
    />
    {marketingRoutesEnabled() && <MarketingHomeFooter/>}
  </>);
}
