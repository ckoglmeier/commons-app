import { TripsIndex } from "@/components/trips-index";
import {
  getCommonsDataMode,
  getCurrentAccountInitials,
  getCurrentCommonsIdentity,
  loadPublicCommonsMemberships,
} from "@/lib/server/commons";

export const dynamic = "force-dynamic";

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
    />
  </>);
}
