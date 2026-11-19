import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { commons, eventCreationAccess, eventCreationDrafts } from "@commons/database";
import { actAs, databaseTestsEnabled, seedSyntheticTrip, withTestDatabase, eq } from "./coordinator-route-harness";
import { registerComponentImportStubs } from "../test-support/hook-harness";

registerComponentImportStubs();

/*
 * Beta rework tier (docs/BETA-REWORK.md BR-03): behind COMMONS_BETA_REWORK_ENABLED a trip carrying
 * commons.activation_draft_id resolves to "beta": direct goals, recipes, polls and participant questions work,
 * and every general-Coordinator, voice, research, personal and setup endpoint refuses with capability_unavailable before
 * any inference. Flag off, nothing changes.
 */

const FLAG_KEYS = ["COMMONS_COORDINATOR_ENABLED", "COMMONS_BETA_REWORK_ENABLED", "COMMONS_PUBLIC_FREE_BETA_ENABLED", "COMMONS_PILOT_TRIP_IDS", "COMMONS_PILOT_ORGANIZER_EMAILS", "COMMONS_EVENT_ONBOARDING_ALLOWLIST"];
function withFlags(values: Record<string, string>) {
  for (const key of FLAG_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

async function markBeta(organizerId: string, eventId: string) {
  const id = randomUUID();
  await withTestDatabase(db => db.insert(eventCreationDrafts).values({ id, createdByPersonId: organizerId, status: "committed", sourceKind: "blank", timezone: "America/Denver", committedEventId: eventId, betaActivationRequired: true, brief: {} } as never));
  await withTestDatabase(db => db.update(commons).set({ activationDraftId: id }).where(eq(commons.id, eventId)));
  return id;
}

async function clearBeta(eventId: string, draftId: string) {
  await withTestDatabase(db => db.update(commons).set({ activationDraftId: null }).where(eq(commons.id, eventId)));
  await withTestDatabase(db => db.delete(eventCreationDrafts).where(eq(eventCreationDrafts.id, draftId)));
}

const coordinatorRoutes = {
  coordinator: "../../app/api/v1/commons/[slug]/coordinator/route",
  turns: "../../app/api/v1/commons/[slug]/coordinator/turns/route",
  live: "../../app/api/v1/commons/[slug]/coordinator/live/route",
  personal: "../../app/api/v1/commons/[slug]/coordinator/personal/route",
  research: "../../app/api/v1/commons/[slug]/coordinator/research/route",
  tasks: "../../app/api/v1/commons/[slug]/coordinator/tasks/route",
  continuity: "../../app/api/v1/commons/[slug]/coordinator/continuity/route",
  threads: "../../app/api/v1/commons/[slug]/coordinator/threads/route",
  sources: "../../app/api/v1/commons/[slug]/coordinator/sources/route",
  brain: "../../app/api/v1/commons/[slug]/coordinator/brain/route",
  researchWorkspace: "../../app/api/v1/commons/[slug]/coordinator/research-workspace/route",
  drafts: "../../app/api/v1/commons/[slug]/coordinator/drafts/route",
  itineraryImport: "../../app/api/v1/commons/[slug]/coordinator/itinerary-import/route",
  settings: "../../app/api/v1/commons/[slug]/coordinator/settings/route",
  turnStop: "../../app/api/v1/commons/[slug]/coordinator/turns/[commandId]/stop/route",
} as const;
const directRoutes = {
  recipes: "../../app/api/v1/commons/[slug]/recipes/route",
  recipePublish: "../../app/api/v1/commons/[slug]/recipes/[runId]/publish/route",
  recipeRevise: "../../app/api/v1/commons/[slug]/recipes/[runId]/revise/route",
  recipeOutcome: "../../app/api/v1/commons/[slug]/recipes/[runId]/outcome/route",
  recipeApply: "../../app/api/v1/commons/[slug]/recipes/[runId]/apply/route",
  recipeAlternatives: "../../app/api/v1/commons/[slug]/recipes/[runId]/alternatives/route",
  recipeAdvice: "../../app/api/v1/commons/[slug]/recipes/[runId]/advice/route",
  recipeArchive: "../../app/api/v1/commons/[slug]/recipes/[runId]/archive/route",
  goalQuestions: "../../app/api/v1/commons/[slug]/goals/[goalId]/questions/route",
} as const;

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
const load = async (files: Record<string, string>) => Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await import(file) as Record<string, Handler>] as const)));
const post = (slug: string, body: unknown = { commandId: randomUUID(), prompt: "Plan dinner" }) =>
  new Request(`http://localhost/api/v1/commons/${slug}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const context = (slug: string) => ({ params: Promise.resolve({ slug, runId: randomUUID(), goalId: randomUUID(), commandId: randomUUID() }) });
const codeOf = async (response: Response) => (await response.clone().json().catch(() => ({}))) as { code?: string };

test("beta tier resolves only behind the flag, only for trips created under activation, and only an operator-listed trip is a pilot", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip({ pilot: false });
  const draftIds: string[] = [];
  try {
    actAs(trip.organizerId);
    const { resolveTripCapabilities, agentCapabilityBlock } = await import("./trip-capabilities");
    draftIds.push(await markBeta(trip.organizerId, trip.eventId));

    withFlags({ COMMONS_BETA_REWORK_ENABLED: "false" });
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "free", "flag off: a beta-created trip resolves exactly as on main");

    withFlags({ COMMONS_BETA_REWORK_ENABLED: "true" });
    assert.deepEqual(await resolveTripCapabilities(trip.eventId), { tier: "beta", coordinator: false, goals: true, pollAssistance: true });
    assert.equal((await resolveTripCapabilities(`qa-${trip.eventId}`)).tier, "beta", "resolved by slug too");
    assert.equal((await agentCapabilityBlock(trip.eventId))?.status, 403, "general Coordinator endpoints refuse");
    assert.equal(await agentCapabilityBlock(trip.eventId, "goals"), null, "direct goal endpoints stay open");

    // An approval or a claimed pilot grant does not lift a trip out of beta; only an operator-listed trip does.
    await withTestDatabase(db => db.insert(eventCreationAccess).values({ personId: trip.organizerId, requesterEmail: "ok@example.invalid", status: "approved", decidedAt: new Date() }));
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "beta");
    await withTestDatabase(db => db.delete(eventCreationAccess).where(eq(eventCreationAccess.personId, trip.organizerId)));
    withFlags({ COMMONS_BETA_REWORK_ENABLED: "true", COMMONS_PILOT_TRIP_IDS: trip.eventId });
    // Coordinator is retired: even an operator-listed pilot trip has no Coordinator, and keeps its goals.
    assert.deepEqual(await resolveTripCapabilities(trip.eventId), { tier: "beta", coordinator: false, goals: true, pollAssistance: true });
    assert.equal((await agentCapabilityBlock(trip.eventId))?.status, 403);
    withFlags({ COMMONS_BETA_REWORK_ENABLED: "true", COMMONS_PILOT_TRIP_IDS: trip.eventId, COMMONS_COORDINATOR_ENABLED: "true" });
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "pilot", "the restore switch still works");
    assert.equal(await agentCapabilityBlock(trip.eventId), null);
    withFlags({ COMMONS_BETA_REWORK_ENABLED: "true" });

    // A trip from before cutover has no marker and is never beta.
    await withTestDatabase(db => db.update(commons).set({ activationDraftId: null }).where(eq(commons.id, trip.eventId)));
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "free");

    // The public sample never becomes beta.
    assert.equal((await resolveTripCapabilities("cape-cod-couples-week")).tier, "free");
  } finally {
    withFlags({});
    await withTestDatabase(db => db.delete(eventCreationAccess).where(eq(eventCreationAccess.personId, trip.organizerId)));
    for (const id of draftIds) await clearBeta(trip.eventId, id);
    await trip.cleanup();
  }
});

test("beta trip: Coordinator, voice, research and personal endpoints refuse before inference; direct goal endpoints do not", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip({ pilot: false });
  const draftId = await markBeta(trip.organizerId, trip.eventId);
  try {
    withFlags({ COMMONS_BETA_REWORK_ENABLED: "true" });
    process.env.COMMONS_COORDINATOR_PERSONALITIES_ENABLED = "true";
    process.env.COMMONS_COORDINATOR_GOALS_ENABLED = "true";
    const refused = await load(coordinatorRoutes), direct = await load(directRoutes);
    const methods: Record<string, string[]> = { research: ["POST", "DELETE"], continuity: ["GET", "POST"], coordinator: ["POST", "PATCH"], threads: ["POST", "PATCH"], sources: ["POST", "DELETE"], settings: ["PATCH"] };
    for (const actor of [trip.organizerId, trip.travelerId]) {
      actAs(actor);
      for (const [name, module] of Object.entries(refused)) {
        for (const method of methods[name] ?? ["POST"]) {
          if (!module[method]) continue;
          const response = await module[method](new Request(`http://localhost/api/v1/commons/${trip.eventId}/x`, { method, headers: { "content-type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify({ commandId: randomUUID(), prompt: "Plan dinner" }) }) }), context(trip.eventId));
          assert.equal(response.status, 403, `${name} ${method}`);
          assert.equal((await codeOf(response)).code, "capability_unavailable", `${name} ${method}`);
        }
      }
    }
    // Direct goal endpoints pass the capability guard (the handler may still reject the empty body for other reasons).
    actAs(trip.organizerId);
    for (const [name, module] of Object.entries(direct)) {
      const response = await module.POST(post(trip.eventId, {}), context(trip.eventId));
      assert.notEqual((await codeOf(response)).code, "capability_unavailable", `${name} stays available on a beta trip`);
    }
    const goals = await import("../../app/api/v1/commons/[slug]/goals/route") as unknown as Record<string, Handler>;
    const base = { commandId: randomUUID(), title: "Dates", goal: "Find workable dates", completionCriterion: "" };
    for (const [index, body] of [{ ...base, op: "start", kind: "research", query: "best beaches" }, { ...base, op: "start", kind: "plan_action" }, { ...base, op: "start", kind: "poll", then: ["poll"] }, { op: "link_proposal", commandId: randomUUID(), goalId: randomUUID(), expectedRevision: 1, turnId: randomUUID() },
      { op: "amend", commandId: randomUUID(), goalId: randomUUID(), expectedRevision: 1, note: "more", query: "restaurants" }].entries()) {
      const response = await goals.POST(post(trip.eventId, body), context(trip.eventId));
      assert.equal(response.status, 403, `#${index} ${await response.clone().text()}`);
      assert.equal((await codeOf(response)).code, "capability_unavailable");
    }
    const allowed = await goals.POST(post(trip.eventId, { ...base, op: "start", kind: "poll" }), context(trip.eventId));
    assert.notEqual((await codeOf(allowed)).code, "capability_unavailable", "a poll-collection goal is direct work");

    // Availability helpers follow the goals capability.
    const { recipesAvailableFor } = await import("./recipe-access");
    const { coordinatorGoalsAvailableFor } = await import("./goal-access");
    assert.equal(await recipesAvailableFor(trip.eventId, { COMMONS_BETA_REWORK_ENABLED: "true", COMMONS_RECIPES_ENABLED: "true" }), true);
    assert.equal(await coordinatorGoalsAvailableFor(trip.eventId, { COMMONS_BETA_REWORK_ENABLED: "true", COMMONS_COORDINATOR_GOALS_ENABLED: "true" }), true);
    withFlags({ COMMONS_BETA_REWORK_ENABLED: "false" });
    assert.equal(await recipesAvailableFor(trip.eventId, { COMMONS_BETA_REWORK_ENABLED: "false", COMMONS_RECIPES_ENABLED: "true" }), false, "flag off: identical to main");
  } finally {
    withFlags({}); delete process.env.COMMONS_COORDINATOR_PERSONALITIES_ENABLED; delete process.env.COMMONS_COORDINATOR_GOALS_ENABLED;
    await clearBeta(trip.eventId, draftId);
    await trip.cleanup();
  }
});
