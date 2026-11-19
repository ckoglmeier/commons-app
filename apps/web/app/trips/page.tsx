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
import { isCommonsOperatorEmail } from "@/lib/server/operator";
import { getEventCreationPageAccess } from "@/lib/server/event-creation";
import { publicFreeBetaEnabled } from "@/lib/server/trip-capabilities";

export const dynamic = "force-dynamic";

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
  const [accountInitials, creationAccess] = await Promise.all([
    getCurrentAccountInitials(identity),
    getEventCreationPageAccess().catch(() => ({ signedIn: true, allowed: false, status: null })),
  ]);
  const joinedCommonsIds = new Set(memberships.map((membership) => membership.commons.id));

  return (
    <TripsIndex
      memberships={memberships}
      pendingInvitations={pendingInvitations.filter((invitation) => !joinedCommonsIds.has(invitation.commons.id))}
      canSignOut={getCommonsDataMode() === "database" && Boolean(identity)}
      accountInitials={accountInitials}
      signedIn={Boolean(identity)}
      creationAccessAllowed={creationAccess.allowed}
      creationAccessStatus={creationAccess.status}
      operator={isCommonsOperatorEmail(identity.email)}
      publicFreeBeta={publicFreeBetaEnabled()}
      organizesTrips={memberships.some((membership) => membership.role === "organizer")}
    />
  );
}
