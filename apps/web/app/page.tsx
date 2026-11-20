import { TripsIndex } from "@/components/trips-index";
import {
  getCommonsDataMode,
  getCurrentAccountInitials,
  getCurrentCommonsIdentity,
  loadPublicCommonsMemberships,
} from "@/lib/server/commons";
import { currentPersonIsInstanceAdmin } from "@/lib/server/instance-access";
import { currentSignInMethod } from "@/lib/server/sign-in-method";

export const dynamic = "force-dynamic";

export default async function Page() {
  const identity = await getCurrentCommonsIdentity();
  const accountInitials = await getCurrentAccountInitials(identity);
  const instanceAdmin = identity ? await currentPersonIsInstanceAdmin().catch(() => false) : false;
  const passwordSignIn = (await currentSignInMethod()) === "password";
  return (<>
    <TripsIndex
      memberships={loadPublicCommonsMemberships()}
      canSignOut={getCommonsDataMode() === "database" && Boolean(identity)}
      accountInitials={accountInitials}
      signedIn={Boolean(identity)}
      publicPage
      passwordSignIn={passwordSignIn}
      instanceAdmin={instanceAdmin}
    />
  </>);
}
