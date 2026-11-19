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

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  if (!marketingRoutesEnabled()) return {};
  return { metadataBase: new URL(marketingOrigin()), alternates: { canonical: '/' }, robots: { index: marketingIndexingEnabled(), follow: marketingIndexingEnabled() } };
}

export default async function Page() {
  const identity = await getCurrentCommonsIdentity();
  const accountInitials = await getCurrentAccountInitials(identity);
  return (<>
    <TripsIndex
      memberships={loadPublicCommonsMemberships()}
      canSignOut={getCommonsDataMode() === "database" && Boolean(identity)}
      accountInitials={accountInitials}
      signedIn={Boolean(identity)}
      publicPage
      supportInFooter={marketingRoutesEnabled()}
    />
    {marketingRoutesEnabled() && <MarketingHomeFooter/>}
  </>);
}
