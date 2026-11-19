import assert from "node:assert/strict";
import test from "node:test";
import type { ItineraryItem } from "@commons/contracts";
import { activityPollOptions } from "./activity-poll-options";

const item = (id: string, over: Partial<ItineraryItem>): ItineraryItem => ({ id, title: `Activity ${id}`, startsAt: "2027-02-13T16:00:00.000Z", participantScope: "everyone", status: "planned", provenanceLabel: "Synthetic", ...over });

test("only shared, uncancelled activities that were requested become poll options, in plan order", () => {
  const items = [item("late", { startsAt: "2027-02-13T22:00:00.000Z" }), item("early", { location: "Bear Lake", expectedCostCents: 4000, expectedCostCurrency: "USD", expectedCostBasis: "per_person" }),
    item("sub", { participantScope: "subgroup" }), item("optional", { participantScope: "optional" }), item("gone", { status: "cancelled" }), item("unrequested", {})];
  const options = activityPollOptions(items, ["late", "early", "sub", "optional", "gone", "missing"], "America/Denver");
  assert.deepEqual(options.map(option => option.id), ["early", "late"]);
  assert.match(options[0].description ?? "", /Sat, Feb 13, 9:00 AM · Bear Lake · Planned · Estimated \$40\.00 each/);
});
