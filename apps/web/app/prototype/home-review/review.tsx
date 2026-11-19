"use client";

import { useState } from "react";
import type { CommonsParticipant, CommonsState, CommonsSummary, TravelPlan } from "@commons/contracts";
import { HomeView } from "@/components/commons-app";

const commons: CommonsSummary = { id: "review", slug: "review", name: "Local Home review", startsOn: null, endsOn: null, locationName: null, timezone: "America/Denver", status: "planning", coverImageUrl: null };
const organizer: CommonsParticipant = { id: "me", displayName: "Organizer", initials: "O", role: "organizer", membershipStatus: "active", accessMode: "account", avatarUrl: null };
const empty: CommonsState = { commonsId: "review", messages: [], proposals: [], itinerary: [], auditEvents: [], processedCommandIds: [], participation: {}, expenses: [], reimbursements: [], moments: [] };
const idea = { id: "picnic", title: "Picnic by the lake", startsAt: null, status: "idea" as const, participantScope: "everyone" as const, provenanceLabel: "Added by Organizer" };
const arrival: TravelPlan = { id: "arrival", personId: "me", personIds: ["me"], personName: "Organizer", kind: "arrival", date: "2030-12-19", route: "Home to lake house", time: "15:00", note: "", visibility: "private", sourceLabel: "Synthetic manual arrival" };

export function HomeReview() {
  const [scenario, setScenario] = useState("Empty");
  const [result, setResult] = useState("");
  const reviewCommons = scenario === "Travel closed" ? { ...commons, status: "archived" as const } : commons;
  const people: CommonsParticipant[] = [organizer];
  const state = { ...empty };
  if (["Invite", "Managed group", "Next plan", "Stay + plans"].includes(scenario)) state.itinerary = [idea];
  if (scenario === "Managed group") people.push({ ...organizer, id: "managed", role: "member", accessMode: "managed" });
  if (scenario === "Waiting") people.push({ ...organizer, id: "invited", role: "member", membershipStatus: "invited" });
  if (scenario === "Next plan" || scenario === "Stay + plans") {
    people.push({ ...organizer, id: "friend", role: "member" });
    state.itinerary = [{ ...idea, status: "planned", startsAt: "2030-12-20T19:00:00Z" }];
    state.participation = { picnic: "in" };
  }
  if (scenario === "Stay + plans") state.stays = [{ id: "house", name: "Lake house", address: "123 Main Street, Denver, CO", startsOn: "2030-12-19", endsOn: "2030-12-22", status: "planned", includedPersonIds: ["me"], sourceLabel: "Synthetic review" }];
  if (scenario.startsWith("Travel")) {
    state.stays = [{ id: "house", name: "Lake house", address: "123 Main Street, Denver, CO", startsOn: "2030-12-19", endsOn: "2030-12-22", status: "planned", includedPersonIds: ["me"], sourceLabel: "Synthetic review" }];
    if (scenario === "Travel arrival saved") state.travelPlans = [arrival];
    if (scenario === "Travel missing time") state.travelPlans = [{ ...arrival, time: undefined }];
    if (scenario === "Travel return only") state.travelPlans = [{ ...arrival, kind: "departure" }];
    if (scenario === "Travel companion" || scenario === "Travel companion missing time") {
      people.push({ ...organizer, id: "friend", role: "member" });
      state.travelPlans = [{ ...arrival, personId: "friend", personIds: ["friend", "me"], time: scenario === "Travel companion missing time" ? undefined : arrival.time }];
    }
    if (scenario === "Travel other person") {
      people.push({ ...organizer, id: "friend", role: "member" });
      state.travelPlans = [{ ...arrival, personId: "friend", personIds: ["friend"], visibility: "basic" }];
    }
  }
  if (scenario.startsWith("Poll")) state.pollRequests = [{ id: "00000000-0000-4000-8000-000000000001", publicId: "123456789abc", title: "Which afternoon works for a picnic and a walk by the lake?", status: "open", canManage: scenario === "Poll organizer", responded: scenario === "Poll answered" }];
  return <main style={{ maxWidth: "72rem", margin: "auto", padding: "20px" }}>
    <label>Local synthetic review <select value={scenario} onChange={e => { setScenario(e.target.value); setResult(""); }}>{["Empty", "Invite", "Waiting", "Managed group", "Next plan", "Stay + plans", "Travel missing", "Travel missing upload", "Travel return only", "Travel missing time", "Travel arrival saved", "Travel companion", "Travel companion missing time", "Travel other person", "Travel closed", "Poll organizer", "Poll recipient", "Poll answered"].map(s => <option key={s}>{s}</option>)}</select></label>
    <p role="status">{result || "No changes or messages are sent from this review."}</p>
    <HomeView travelUploadAvailable={scenario === "Travel missing upload"} state={state} commons={reviewCommons} participants={people} currentActorId="me" activityParticipation={state.participation} addReceipt={() => setResult("Open expense review")} openProposal={() => setResult("Open proposal")} openTranscript={() => setResult("Open conversation")} addPlan={() => setResult("Open Add plan")} addTravelPlans={() => setResult("Open Logistics")} goToPlan={date => setResult(`Open Plan${date ? ` on ${date}` : ""}`)} goToMoney={() => {}} goToChoiceDay={() => {}} copyAddress={() => {}} openTripDetails={() => {}} openStay={() => {}} />
  </main>;
}
