import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { createHookRenderer, registerComponentImportStubs } from "../lib/test-support/hook-harness";
import { pilotSnapshot } from "../lib/pilot-fixture";
import { tripDays } from "../lib/plan-days";
registerComponentImportStubs();

for (const parallel of [false, true]) test(`only open-invitation plans offer attendance controls (${parallel ? "simultaneous" : "standalone"})`, async () => {
  const { PlanView } = await import("./commons-app");
  const state = structuredClone(pilotSnapshot.state);
  const original = state.itinerary[0];
  const day = "2026-10-12";
  const noop = () => {};
  for (const participantScope of ["everyone", "subgroup", "optional"] as const) {
    const plan = {...original, id: "test-plan", title: "Synthetic activity", status: "confirmed" as const, startsAt: `${day}T15:00:00.000Z`, participantScope, participantIds:[pilotSnapshot.currentActor.id]};
    state.itinerary = parallel ? [plan, {...plan, id:"second-plan", title:"Other activity"}] : [plan];
    state.participation = {"test-plan":"in"};
    const before = structuredClone(state);
    const renderer = createHookRenderer({expand:[PlanView]});
    try {
      renderer.render(createElement(PlanView, {state, commons:{...pilotSnapshot.commons, timezone:"America/Denver"}, days:tripDays(day,day), selectedDay:day, seededPilot:false, openItem:noop, canSchedule:true, setSelectedDay:noop, openProposal:noop, activityParticipation:state.participation, respondToActivity:noop, openMoments:noop, travelPlans:[], openTravelPlans:noop, participantCount:pilotSnapshot.participants.length, participants:pilotSnapshot.participants, addPlan:noop, editPlan:noop, scheduleIdea:noop, canEditPlan:true, openStay:noop, openTripDetails:noop, showAlternatives:false}));
      renderer.flush();
      let present = false;
      try { renderer.find(node => typeof node.type === "function" && node.type.name === "AttendanceControl"); present = true; } catch { /* No attendance control is expected for assigned people. */ }
      assert.equal(present, participantScope === "optional", participantScope);
      assert.deepEqual(state,before,"Rendering must preserve saved participation");
    } finally {renderer.unmount();}
  }
});
