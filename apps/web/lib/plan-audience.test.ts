import assert from "node:assert/strict";
import test from "node:test";
import type { CommonsState } from "@commons/contracts";
import { planAudienceValue } from "./plan-audience";

const soloPlan: CommonsState["itinerary"][number] = {
  id: "spa", title: "Spa", startsAt: null, status: "idea", provenanceLabel: "Maya added this",
  participantScope: "subgroup", participantIds: ["maya"], expectedParticipantIds: ["maya"],
};

test("reopens a solo plan as Just me only for its attendee", () => {
  assert.equal(planAudienceValue(soloPlan, "maya"), "self");
  assert.equal(planAudienceValue(soloPlan, "ben"), "subgroup");
});

test("preserves group scope when another traveler is going or expected", () => {
  assert.equal(planAudienceValue({ ...soloPlan, participantIds: ["maya", "ben"] }, "maya"), "subgroup");
  assert.equal(planAudienceValue({ ...soloPlan, expectedParticipantIds: ["maya", "ben"] }, "maya"), "subgroup");
  assert.equal(planAudienceValue({ ...soloPlan, participantIds: [] }, "maya"), "subgroup");
  assert.equal(planAudienceValue({ ...soloPlan, participantScope: "everyone" }, "maya"), "everyone");
  assert.equal(planAudienceValue({ ...soloPlan, participantScope: "optional" }, "maya"), "optional");
});
