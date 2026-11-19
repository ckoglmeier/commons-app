import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { syntheticItinerary } from "../../../../packages/contracts/src/fixtures/research-itinerary";
import { databaseTestsEnabled, withCoordinatorScenario, jsonRequest, params } from "./coordinator-route-harness";

for (const identity of ["owner", "other", "disabled"] as const) test(`activity account gate: ${identity}`, { skip: !databaseTestsEnabled }, () => withCoordinatorScenario(async s => {
  const { canUseActivityDecisions } = await import("./activity-decision-access");
  s.next.extra = { ...syntheticItinerary(), items: syntheticItinerary().items.map(item => ({ ...item, day: "2027-02-12" })) };
  const threadId = randomUUID();
  const first = await s.post(s.command({ target: { kind: "new", threadId }, text: "Build an itinerary", explicitAction: { kind: "itinerary", baseVersion: 0 } }));
  assert.equal(first.body.status, "completed", JSON.stringify(first.body));
  assert.equal(await canUseActivityDecisions(), identity === "owner");
  let loaded = await s.thread(threadId), turn = loaded.turns.at(-1), draft = turn.workspace.itineraryDraft;
  const act = (change: Record<string, unknown>) => s.routes.turn.PATCH(jsonRequest(s.trip.eventId, "", "PATCH", { action: "itinerary", operation: "revise", commandId: randomUUID(), threadId, turnId: turn.id, expectedVersion: draft.version, ...change }), params(s.trip.eventId));
  const legacy = await act({ content: { ...draft.content, opening: "A basic itinerary edit still works." } });
  assert.equal(legacy.status, 200, JSON.stringify(await legacy.clone().json()));
  loaded = await s.thread(threadId); turn = loaded.turns.at(-1); draft = turn.workspace.itineraryDraft;
  const advanced = { ...draft.content, questions: [{ id: "lunch", prompt: "Where for lunch?", resolved: true }] };
  const result = await act({ content: advanced });
  if (identity === "owner") {
    assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
    const saved = (await s.thread(threadId)).turns.at(-1).workspace.itineraryDraft;
    assert.equal(saved.version, draft.version + 1); assert.equal(saved.content.questions[0].resolved, true);
    draft = saved;
    for (const value of ["another@example.invalid", ""]) {
      process.env.COMMONS_TEST_SEARCH_EMAIL = value;
      const denied = await act({ operation: "prepare_poll" });
      assert.equal((await denied.json()).code, "unsupported_capability", "an existing advanced document cannot bypass account verification");
      assert.deepEqual((await s.thread(threadId)).turns.at(-1).workspace.itineraryDraft, saved);
    }
    process.env.COMMONS_TEST_SEARCH_EMAIL = "organizer@example.com";
  } else {
    assert.equal((await result.json()).code, "unsupported_capability");
    for (const operation of ["apply", "update_plan", "link_existing"]) assert.equal((await (await act({ operation, selectedIds: [], taskIds: [] })).json()).code, "unsupported_capability");
    const saved = (await s.thread(threadId)).turns.at(-1).workspace.itineraryDraft;
    assert.deepEqual(saved, draft, "denied forged commands leave the durable document unchanged");
    const prepare = await act({ operation: "prepare_poll" });
    assert.equal(prepare.status, 200, JSON.stringify(await prepare.clone().json()));
  }
  assert.equal(s.network.tavilyCalls.length, 0);
}, { environment: { COMMONS_COORDINATOR_INFERENCE_POLICY: "openai", COMMONS_ASSISTANT_UI_ENABLED: "true", COMMONS_ACTIVITY_DECISIONS_PILOT_ENABLED: identity === "disabled" ? "false" : "true", COMMONS_TEST_SEARCH_EMAIL: identity === "other" ? "another@example.invalid" : "organizer@example.com" } }));


test("all-user beta grants the existing advanced organizer gate to a verified non-owner and refuses missing verified identity",{skip:!databaseTestsEnabled},()=>withCoordinatorScenario(async()=>{
 const {canUseActivityDecisions}=await import("./activity-decision-access");
 assert.equal(await canUseActivityDecisions(),true);
 process.env.COMMONS_TEST_SEARCH_EMAIL="";assert.equal(await canUseActivityDecisions(),false);
},{environment:{COMMONS_ASSISTANT_UI_ENABLED:"true",COMMONS_ACTIVITY_DECISIONS_PILOT_ENABLED:"true",COMMONS_RESEARCH_BETA_ENABLED:"true",COMMONS_TEST_SEARCH_EMAIL:"another-beta@example.invalid"}}));
