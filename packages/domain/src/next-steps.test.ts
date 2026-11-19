import assert from "node:assert/strict";
import test from "node:test";
import type { CommonsParticipant, CommonsState, CommonsSummary, TravelPlan } from "@commons/contracts";
import { nextSteps } from "./next-steps";

const commons: CommonsSummary = { id: "trip", slug: "trip", name: "Trip", startsOn: "2026-10-10", endsOn: "2026-10-14", locationName: "Sonoma", timezone: "America/Denver", status: "planning", coverImageUrl: null };
const state: CommonsState = { commonsId: "trip", messages: [], proposals: [], itinerary: [], auditEvents: [], processedCommandIds: [], participation: {}, expenses: [], reimbursements: [], moments: [], stays: [{ id: "stay", name: "House", address: "Main Street", startsOn: "2026-10-10", endsOn: "2026-10-14", status: "planned", includedPersonIds: ["me"], sourceLabel: "Saved by organizer" }] };
const participants: CommonsParticipant[] = ["me", "other"].map(id => ({ id, displayName: id, initials: "M", role: "member", membershipStatus: "active", avatarUrl: null }));
const arrival: TravelPlan = { id: "arrival", personId: "me", personIds: ["me"], personName: "Me", kind: "arrival", date: "2026-10-09", route: "Home to Sonoma", time: "15:00", note: "PRIVATE NOTE", confirmationCode: "SECRET", visibility: "private", sourceLabel: "Entered manually" };
const input = { commons, state, participants, personId: "me", now: Date.parse("2026-10-01T12:00:00Z"), travelState: "loaded" as const };

test("missing travel produces a person- and trip-scoped recommendation, not a booking claim", () => {
  const result = nextSteps(input);
  assert.equal(result.travelThere, "missing");
  assert.deepEqual(result.steps[0], { id: "arrival_missing:trip:me", commonsId: "trip", personId: "me", reason: "arrival_missing", sourceIds: [], evidence: [], eligibility: "actionable", capability:{manual:true,upload:false,review:false},completion:"usable_saved_arrival", target: { kind: "travel", planId: null, canEdit: true } });
});

test("manual and imported arrivals both suppress upload requests, regardless of sharing or group dates", () => {
  for (const visibility of ["private", "basic", "all"] as const) {
    for (const confirmationDocumentFileName of [undefined, "itinerary.pdf"]) {
      assert.deepEqual(nextSteps({ ...input, state: { ...state, travelPlans: [{ ...arrival, visibility, confirmationDocumentFileName }] } }), { travelThere: "saved", steps: [] });
    }
  }
});

test("return-only travel and rental bookings never satisfy travel there", () => {
  for (const kind of ["departure", "car_rental"] as const) {
    assert.equal(nextSteps({ ...input, state: { ...state, travelPlans: [{ ...arrival, kind }] } }).travelThere, "missing");
  }
});

test("another person's booking and an uploader not included in the journey do not cover this traveler", () => {
  for (const personId of ["other", "me"]) {
    assert.equal(nextSteps({ ...input, state: { ...state, travelPlans: [{ ...arrival, personId, personIds: ["other"] }] } }).travelThere, "missing");
  }
});

test("a companion's private arrangement covers an explicitly included traveler", () => {
  assert.deepEqual(nextSteps({ ...input, state: { ...state, travelPlans: [{ ...arrival, personId: "other", personIds: ["other", "me"] }] } }), { travelThere: "saved", steps: [] });
});

test("missing arrival time targets the existing record and respects the owner's editing authority", () => {
  for (const personId of ["me", "other"]) {
    const result = nextSteps({ ...input, state: { ...state, travelPlans: [{ ...arrival, personId, personIds: ["me"], time: undefined }] } });
    assert.equal(result.travelThere, "incomplete");
    assert.equal(result.steps[0].reason, "arrival_time_missing");
    assert.deepEqual(result.steps[0].sourceIds, ["arrival"]);
    assert.deepEqual(result.steps[0].target, { kind: "travel", planId: "arrival", canEdit: personId === "me" });
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE NOTE|SECRET|Home to Sonoma/);
  }
});

test("a usable arrival wins over an incomplete alternative; considering is not saved travel", () => {
  assert.equal(nextSteps({ ...input, state: { ...state, travelPlans: [{ ...arrival, id: "incomplete", time: undefined }, arrival] } }).travelThere, "saved");
  assert.equal(nextSteps({ ...input, state: { ...state, travelPlans: [{ ...arrival, status: "considering" }] } }).travelThere, "missing");
});

test("local, still-forming, or rental-only events do not acquire a universal travel task", () => {
  const emptyContext = { ...state, stays: [], travelPlans: [] };
  assert.equal(nextSteps({ ...input, state: emptyContext }).travelThere, "not_applicable");
  assert.equal(nextSteps({ ...input, state: { ...emptyContext, travelPlans: [{ ...arrival, kind: "car_rental" }] } }).travelThere, "not_applicable");
  assert.equal(nextSteps({ ...input, state: { ...emptyContext, stays: state.stays!.map(stay => ({ ...stay, status: "considering" })) } }).travelThere, "not_applicable");
});

test("unavailable data, wrong trip, inactive membership, or invalid time fail closed", () => {
  const cases = [
    { ...input, travelState: "unavailable" as const },
    { ...input, state: { ...state, commonsId: "different-trip" } },
    { ...input, participants: participants.map(person => ({ ...person, membershipStatus: "invited" as const })) },
    { ...input, personId: "unknown" },
    { ...input, now: NaN },
    { ...input, commons: { ...commons, timezone: "not-a-timezone" } },
  ];
  for (const candidate of cases) assert.deepEqual(nextSteps(candidate), { travelThere: "unavailable", steps: [] });
});

test("closed trips and past trips suppress intake, using the trip's local end date", () => {
  for (const status of ["closing", "archived"] as const) assert.equal(nextSteps({ ...input, commons: { ...commons, status } }).travelThere, "not_applicable");
  assert.equal(nextSteps({ ...input, now: Date.parse("2026-10-15T05:59:00Z") }).travelThere, "missing");
  assert.equal(nextSteps({ ...input, now: Date.parse("2026-10-15T06:00:00Z") }).travelThere, "not_applicable");
});


test("accepted intake stays scoped and processing/review never re-asks for upload",()=>{
 const intake={id:"private-intake",commonsId:"trip",ownerPersonId:"me",kind:"flight",revision:2,status:"processing"};
 for(const status of ["processing","awaiting_review","failed"]){const r=nextSteps({...input,intakes:[{...intake,status}],uploadAvailable:true});assert.equal(r.steps[0].intakeId,intake.id);assert.equal(r.steps[0].reason,status==="processing"?"arrival_processing":status==="awaiting_review"?"arrival_review":"arrival_intake_failed");}
 assert.equal(nextSteps({...input,intakes:[{...intake,ownerPersonId:"other"}]}).travelThere,"missing");
 assert.equal(nextSteps({...input,intakes:[{...intake,commonsId:"other-trip"}]}).travelThere,"missing");
 assert.equal(nextSteps({...input,intakeState:"unavailable"}).travelThere,"unavailable");
 assert.equal(nextSteps({...input,intakes:[{...intake,status:"awaiting_review",draft:{travelSegments:[{kind:"departure"}]}}]}).travelThere,"missing");
 assert.deepEqual(nextSteps({...input,intakes:[intake],state:{...state,travelPlans:[arrival]}}),{travelThere:"saved",steps:[]});
});

test("a delayed next step is suppressed across person/trip changes, completion or changed evidence",async()=>{
  const {currentNextStep}=await import("./next-steps");
  const step={id:"intake:one",scope:{tripId:"96000000-0000-4000-8000-0000000000a1",personId:"owner",audience:"person" as const},reason:"arrival_review",evidence:[{id:"intake",version:"1"}],eligibility:"actionable" as const,target:{kind:"travel" as const,id:"intake"},capability:{action:"resume_review" as const,available:true,reason:null},completion:"usable_saved_arrival" as const};
  assert.equal(currentNextStep(step,[step]),step);assert.equal(currentNextStep(step,[]),null);
  assert.equal(currentNextStep(step,[{...step,scope:{...step.scope,personId:"other"}}]),null);
  assert.equal(currentNextStep(step,[{...step,scope:{...step.scope,tripId:"another"}}]),null);
  assert.equal(currentNextStep(step,[{...step,evidence:[{id:"intake",version:"2"}]}]),null);
  assert.equal(currentNextStep(step,[{...step,eligibility:"completed"}]),null);
});
