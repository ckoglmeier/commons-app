import { redirect } from "next/navigation";
import { TripsIndex } from "@/components/trips-index";
import {
  CommonsAuthenticationRequiredError,
  getCommonsDataMode,
  getCurrentAccountInitials,
  getCurrentCommonsIdentity,
  loadCurrentCommonsMemberships,
  loadCurrentPendingInvitations,
} from "@/lib/server/commons";
import { currentPersonIsInstanceAdmin } from "@/lib/server/instance-access";
import { currentSignInMethod } from "@/lib/server/sign-in-method";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your trips — Commons" };

export default async function TripsPage() {
  const identity = await getCurrentCommonsIdentity();
  if (!identity) redirect("/");

  let memberships: Awaited<ReturnType<typeof loadCurrentCommonsMemberships>>;
  let pendingInvitations: Awaited<ReturnType<typeof loadCurrentPendingInvitations>>;
  try {
    [memberships, pendingInvitations] = await Promise.all([
      loadCurrentCommonsMemberships(),
      loadCurrentPendingInvitations(),
    ]);
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      redirect("/sign-in?next=%2Ftrips");
    }
    throw error;
  }
  const accountInitials = await getCurrentAccountInitials(identity);
  const instanceAdmin = await currentPersonIsInstanceAdmin().catch(() => false);
  const passwordSignIn = (await currentSignInMethod()) === "password";
  const joinedCommonsIds = new Set(memberships.map((membership) => membership.commons.id));

  return (
    <TripsIndex
      memberships={memberships}
      pendingInvitations={pendingInvitations.filter((invitation) => !joinedCommonsIds.has(invitation.commons.id))}
      canSignOut={getCommonsDataMode() === "database" && Boolean(identity)}
      accountInitials={accountInitials}
      signedIn={Boolean(identity)}
      organizesTrips={memberships.some((membership) => membership.role === "organizer")}
      passwordSignIn={passwordSignIn}
      instanceAdmin={instanceAdmin}
    />
  );
}
