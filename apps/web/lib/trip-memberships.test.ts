import assert from "node:assert/strict";
import test from "node:test";
import { CommonsMembershipSummarySchema } from "@commons/contracts";
import { groupTripMemberships } from "./trip-memberships";

function membership(status: "planning" | "active" | "closing" | "archived") {
  return CommonsMembershipSummarySchema.parse({
    commons: {
      id: `trip-${status}`,
      slug: `trip-${status}`,
      name: `${status} trip`,
      startsOn: null,
      endsOn: null,
      locationName: null,
      timezone: "America/Denver",
      status,
      coverImageUrl: null,
      setupCompletedAt: "2026-09-01T12:00:00.000Z",
      firstSharedAt: null,
    },
    role: "organizer",
    participantCount: 2,
  });
}

test("keeps archived trips out of current and past event groups", () => {
  const grouped = groupTripMemberships([
    membership("planning"),
    membership("active"),
    membership("closing"),
    membership("archived"),
  ]);

  assert.deepEqual(grouped.currentTrips.map((trip) => trip.commons.status), ["planning", "active"]);
  assert.deepEqual(grouped.pastTrips.map((trip) => trip.commons.status), ["closing"]);
  assert.deepEqual(grouped.archivedTrips.map((trip) => trip.commons.status), ["archived"]);
});
