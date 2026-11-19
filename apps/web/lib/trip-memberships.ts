import type { CommonsMembershipSummary } from "@commons/contracts";

export function groupTripMemberships(memberships: CommonsMembershipSummary[]) {
  return {
    currentTrips: memberships.filter(
      (trip) => trip.commons.status === "planning" || trip.commons.status === "active",
    ),
    pastTrips: memberships.filter((trip) => trip.commons.status === "closing"),
    archivedTrips: memberships.filter((trip) => trip.commons.status === "archived"),
  };
}
