import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { eventCreationAccess, identities, memberships } from "@commons/database";
import { actAs, databaseTestsEnabled, seedSyntheticTrip, withTestDatabase, and, eq } from "./coordinator-route-harness";
import { registerComponentImportStubs } from "../test-support/hook-harness";

registerComponentImportStubs();
// Same normalization as @commons/database tokens.hashNormalizedEmail.
const hashNormalizedEmail = (value: string) => createHash("sha256").update(value.trim().toLowerCase()).digest("hex");

/*
 * Free beta capability boundary (trip-capabilities.ts): direct requests to held-back agent endpoints are refused on a
 * free trip before any inference, pilot access needs an explicit grant on an active organizer, and the "all beta users"
 * research flag or open creation never grant it.
 */

const FLAG_KEYS = ["COMMONS_PUBLIC_FREE_BETA_ENABLED", "COMMONS_PILOT_TRIP_IDS", "COMMONS_PILOT_ORGANIZER_EMAILS", "COMMONS_EVENT_ONBOARDING_ALLOWLIST", "COMMONS_RESEARCH_BETA_ENABLED", "COMMONS_EVENT_ONBOARDING_ENABLED"];
function withFlags(values: Record<string, string>) {
  for (const key of FLAG_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

const routeFiles = {
  coordinator: "../../app/api/v1/commons/[slug]/coordinator/route",
  turns: "../../app/api/v1/commons/[slug]/coordinator/turns/route",
  live: "../../app/api/v1/commons/[slug]/coordinator/live/route",
  personal: "../../app/api/v1/commons/[slug]/coordinator/personal/route",
  research: "../../app/api/v1/commons/[slug]/coordinator/research/route",
  tasks: "../../app/api/v1/commons/[slug]/coordinator/tasks/route",
  goals: "../../app/api/v1/commons/[slug]/goals/route",
  continuity: "../../app/api/v1/commons/[slug]/coordinator/continuity/route",
  threads: "../../app/api/v1/commons/[slug]/coordinator/threads/route",
  sources: "../../app/api/v1/commons/[slug]/coordinator/sources/route",
  brain: "../../app/api/v1/commons/[slug]/coordinator/brain/route",
  recipes: "../../app/api/v1/commons/[slug]/recipes/route",
  researchWorkspace: "../../app/api/v1/commons/[slug]/coordinator/research-workspace/route",
  drafts: "../../app/api/v1/commons/[slug]/coordinator/drafts/route",
  itineraryImport: "../../app/api/v1/commons/[slug]/coordinator/itinerary-import/route",
  itineraryImportApply: "../../app/api/v1/commons/[slug]/coordinator/itinerary-import/apply/route",
  turnStop: "../../app/api/v1/commons/[slug]/coordinator/turns/[commandId]/stop/route",
  settings: "../../app/api/v1/commons/[slug]/coordinator/settings/route",
  recipeAdvice: "../../app/api/v1/commons/[slug]/recipes/[runId]/advice/route",
  recipeAlternatives: "../../app/api/v1/commons/[slug]/recipes/[runId]/alternatives/route",
  recipeApply: "../../app/api/v1/commons/[slug]/recipes/[runId]/apply/route",
  recipeArchive: "../../app/api/v1/commons/[slug]/recipes/[runId]/archive/route",
  recipeOutcome: "../../app/api/v1/commons/[slug]/recipes/[runId]/outcome/route",
  recipePublish: "../../app/api/v1/commons/[slug]/recipes/[runId]/publish/route",
  recipeRevise: "../../app/api/v1/commons/[slug]/recipes/[runId]/revise/route",
  goalQuestions: "../../app/api/v1/commons/[slug]/goals/[goalId]/questions/route",
} as const;

async function loadRoutes() {
  registerComponentImportStubs();
  const entries = await Promise.all(Object.entries(routeFiles).map(async ([key, file]) => [key, await import(file)] as const));
  return Object.fromEntries(entries) as Record<keyof typeof routeFiles, Record<string, (request: Request, context: { params: Promise<{ slug: string }> }) => Promise<Response>>>;
}

const request = (slug: string, method: string, body: unknown = { commandId: randomUUID(), prompt: "Plan dinner" }) =>
  new Request(`http://localhost/api/v1/commons/${slug}/coordinator`, { method, headers: { "content-type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
const context = (slug: string) => ({ params: Promise.resolve({ slug, runId: randomUUID(), goalId: randomUUID(), commandId: randomUUID() }) });

test("free trip: every held-back agent endpoint refuses direct requests with capability_unavailable", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip({ pilot: false });
  try {
    actAs(trip.organizerId);
    withFlags({ COMMONS_PUBLIC_FREE_BETA_ENABLED: "true", COMMONS_RESEARCH_BETA_ENABLED: "true", COMMONS_EVENT_ONBOARDING_ENABLED: "true" });
    process.env.COMMONS_COORDINATOR_PERSONALITIES_ENABLED = "true";
    const { resolveTripCapabilities } = await import("./trip-capabilities");
    assert.deepEqual(await resolveTripCapabilities(trip.eventId), { tier: "free", coordinator: false, goals: false, pollAssistance: true }, "the all-users research beta and open creation grant no pilot access");
    const routes = await loadRoutes();
    const calls: Array<[keyof typeof routeFiles, string]> = [["coordinator", "POST"], ["coordinator", "PATCH"], ["turns", "POST"], ["live", "POST"], ["personal", "POST"],
      ["research", "POST"], ["research", "DELETE"], ["tasks", "POST"], ["goals", "POST"], ["goals", "PATCH"], ["continuity", "GET"], ["continuity", "POST"], ["threads", "POST"],
      ["sources", "POST"], ["brain", "POST"], ["recipes", "POST"], ["researchWorkspace", "POST"], ["drafts", "POST"], ["itineraryImport", "POST"],
      ["itineraryImportApply", "POST"], ["turnStop", "POST"], ["settings", "PATCH"], ["recipeAdvice", "POST"], ["recipeAlternatives", "POST"], ["recipeApply", "POST"],
      ["recipeArchive", "POST"], ["recipeOutcome", "POST"], ["recipePublish", "POST"], ["recipeRevise", "POST"], ["goalQuestions", "POST"]];
    for (const actor of [trip.organizerId, trip.travelerId]) {
      actAs(actor);
      for (const [route, method] of calls) {
        const handler = routes[route][method];
        assert.ok(handler, `${route} ${method} exists`);
        const response = await handler(request(trip.eventId, method), context(trip.eventId));
        assert.equal(response.status, 403, `${route} ${method} as ${actor === trip.organizerId ? "organizer" : "traveler"}`);
        const body = await response.json() as { code?: string; error?: string };
        assert.equal(body.code, "capability_unavailable");
        assert.doesNotMatch(JSON.stringify(body), /Breckenridge|Synthetic/, "the refusal carries no trip data");
      }
    }
    // Recipes and goals helpers agree with the route guard.
    const { recipesAvailableFor } = await import("./recipe-access");
    const { coordinatorGoalsAvailableFor } = await import("./goal-access");
    assert.equal(await recipesAvailableFor(trip.eventId), false);
    assert.equal(await coordinatorGoalsAvailableFor(trip.eventId), false);
  } finally { withFlags({}); delete process.env.COMMONS_COORDINATOR_PERSONALITIES_ENABLED; await trip.cleanup(); }
});

test("pilot access: approved grant on an active organizer keeps capabilities; removed organizers and revoked grants do not", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip({ pilot: false });
  try {
    actAs(trip.organizerId);
    const { resolveTripCapabilities, agentCapabilityBlock, accountHasPilotCapabilities } = await import("./trip-capabilities");
    const { coordinatorGoalsAvailableFor } = await import("./goal-access");
    const { recipesAvailableFor } = await import("./recipe-access");
    withFlags({});
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "free", "flag off grants no pilot access");
    assert.equal((await agentCapabilityBlock(trip.eventId))?.status, 403);
    withFlags({ COMMONS_PUBLIC_FREE_BETA_ENABLED: "true" });
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "free");
    assert.equal(await accountHasPilotCapabilities(trip.coOrganizerId), false);
    await withTestDatabase(db => db.insert(eventCreationAccess).values({ personId: trip.coOrganizerId, requesterEmail: "robin@example.invalid", status: "approved", decidedAt: new Date() }));
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "pilot", "an approved co-organizer keeps the trip on pilot");
    assert.equal(await agentCapabilityBlock(trip.eventId), null);
    assert.equal(await accountHasPilotCapabilities(trip.coOrganizerId), true);
    assert.equal(await coordinatorGoalsAvailableFor(trip.eventId, { COMMONS_COORDINATOR_GOALS_ENABLED: "true" }), true);
    assert.equal(await recipesAvailableFor(trip.eventId, { COMMONS_RECIPES_ENABLED: "true" }), true);
    withFlags({});
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "pilot", "an explicit pilot survives closing public signup");
    assert.equal(await accountHasPilotCapabilities(trip.coOrganizerId), true);
    assert.equal(await coordinatorGoalsAvailableFor(trip.eventId, { COMMONS_COORDINATOR_GOALS_ENABLED: "true" }), true, "explicit pilots keep Goals with signup closed");
    assert.equal(await recipesAvailableFor(trip.eventId, { COMMONS_RECIPES_ENABLED: "true" }), true, "explicit pilots keep recipes with signup closed");
    await withTestDatabase(db => db.update(memberships).set({ role: "member" }).where(and(eq(memberships.commonsId, trip.eventId), eq(memberships.personId, trip.coOrganizerId))));
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "free", "demoting the last approved organizer downgrades the trip");
    assert.equal(await coordinatorGoalsAvailableFor(trip.eventId), false);
    assert.equal(await recipesAvailableFor(trip.eventId), false);
    await withTestDatabase(db => db.update(memberships).set({ role: "organizer" }).where(and(eq(memberships.commonsId, trip.eventId), eq(memberships.personId, trip.coOrganizerId))));
    withFlags({ COMMONS_PUBLIC_FREE_BETA_ENABLED: "true" });
    await withTestDatabase(db => db.update(memberships).set({ status: "removed" }).where(and(eq(memberships.commonsId, trip.eventId), eq(memberships.personId, trip.coOrganizerId))));
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "free", "a removed organizer's grant no longer counts");
    await withTestDatabase(db => db.update(memberships).set({ status: "active" }).where(and(eq(memberships.commonsId, trip.eventId), eq(memberships.personId, trip.coOrganizerId))));
    await withTestDatabase(db => db.update(eventCreationAccess).set({ status: "revoked" }).where(eq(eventCreationAccess.personId, trip.coOrganizerId)));
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "free", "a revoked grant no longer counts");
    // A traveler's grant does not make the trip pilot.
    await withTestDatabase(db => db.insert(eventCreationAccess).values({ personId: trip.travelerId, requesterEmail: "taylor@example.invalid", status: "approved", decidedAt: new Date() }));
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "free");
  } finally {
    withFlags({});
    await withTestDatabase(db => db.delete(eventCreationAccess).where(eq(eventCreationAccess.personId, trip.coOrganizerId)));
    await withTestDatabase(db => db.delete(eventCreationAccess).where(eq(eventCreationAccess.personId, trip.travelerId)));
    await trip.cleanup();
  }
});

test("pilot email list counts only a claimed email on a signed-in organizer; the public sample is always free", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip({ pilot: false });
  const email = `pilot-${trip.eventId.slice(0, 8)}@example.invalid`;
  try {
    actAs(trip.organizerId);
    const { resolveTripCapabilities } = await import("./trip-capabilities");
    withFlags({ COMMONS_PUBLIC_FREE_BETA_ENABLED: "true", COMMONS_PILOT_ORGANIZER_EMAILS: email });
    await withTestDatabase(db => db.insert(identities).values({ personId: trip.organizerId, kind: "email", normalizedHash: hashNormalizedEmail(email), state: "observed" }));
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "free", "an observed (unclaimed) email is not enough");
    await withTestDatabase(db => db.update(identities).set({ state: "claimed" }).where(eq(identities.normalizedHash, hashNormalizedEmail(email))));
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "pilot");
    withFlags({});
    assert.equal((await resolveTripCapabilities("cape-cod-couples-week")).tier, "free", "the sample demonstrates the free product");
  } finally {
    withFlags({});
    await withTestDatabase(db => db.delete(identities).where(eq(identities.normalizedHash, hashNormalizedEmail(email))));
    await trip.cleanup();
  }
});

test("operator-listed pilot trips keep capabilities when the public flag turns on; recipes-only lists do not widen", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip({ pilot: false });
  try {
    actAs(trip.organizerId);
    const { resolveTripCapabilities } = await import("./trip-capabilities");
    withFlags({ COMMONS_PUBLIC_FREE_BETA_ENABLED: "true" });
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "free");
    process.env.COMMONS_RECIPES_PILOT_TRIP_IDS = `other-trip, ${trip.eventId.toUpperCase()}`;
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "free", "a recipes-only allowance never grants Coordinator");
    delete process.env.COMMONS_RECIPES_PILOT_TRIP_IDS;
    process.env.COMMONS_PILOT_TRIP_IDS = ` ${trip.eventId.toUpperCase()} `;
    assert.equal((await resolveTripCapabilities(trip.eventId)).tier, "pilot", "an operator-listed pilot trip keeps its capabilities");
    assert.equal((await resolveTripCapabilities(`qa-${trip.eventId}`)).tier, "pilot", "resolved by slug too");
  } finally { withFlags({}); delete process.env.COMMONS_RECIPES_PILOT_TRIP_IDS; delete process.env.COMMONS_PILOT_TRIP_IDS; await trip.cleanup(); }
});

test("setup chat refuses accounts without pilot access; poll help refuses non-organizers before any provider call", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip({ pilot: false });
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  try {
    actAs(trip.organizerId);
    withFlags({ COMMONS_PUBLIC_FREE_BETA_ENABLED: "true" });
    Object.assign(process.env, { COMMONS_COORDINATOR_ONBOARDING_ENABLED: "true", OPENAI_API_KEY: "sk-synthetic-test", COMMONS_POLL_MODEL: "gpt-4.1-mini" });
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => { if (String(args[0]).includes("openai.com")) providerCalls++; return originalFetch(...args); }) as typeof fetch;
    const setup = await import("../../app/api/v1/event-creation-drafts/[draftId]/coordinator/route");
    const { currentAccountHasPilotCapabilities } = await import("./event-creation");
    for (const enabled of ["true", "false"]) {
      withFlags({ COMMONS_PUBLIC_FREE_BETA_ENABLED: enabled });
      assert.equal(await currentAccountHasPilotCapabilities(), false, "setup UI is restricted with either signup flag");
      const setupResponse = await setup.POST(new Request("http://localhost/api/v1/event-creation-drafts/x/coordinator", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "message", commandId: randomUUID(), version: 0, text: "Plan a ski weekend" }) }), { params: Promise.resolve({ draftId: randomUUID() }) });
      assert.equal(setupResponse.status, 403);
      assert.equal((await setupResponse.json() as { code?: string }).code, "capability_unavailable");
    }
    await withTestDatabase(db => db.insert(eventCreationAccess).values({ personId: trip.organizerId, requesterEmail: "casey@example.invalid", status: "approved", decidedAt: new Date() }));
    assert.equal(await currentAccountHasPilotCapabilities(), true, "an explicitly approved account keeps setup UI access");
    const suggestions = await import("../../app/api/v1/commons/[slug]/poll-suggestions/route");
    for (const actor of [trip.travelerId, randomUUID()]) {
      actAs(actor);
      const response = await suggestions.POST(new Request(`http://localhost/api/v1/commons/${trip.eventId}/poll-suggestions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: randomUUID(), version: 1, commandId: randomUUID() }) }), { params: Promise.resolve({ slug: trip.eventId }) });
      assert.ok([401, 403, 404, 409].includes(response.status), `non-organizer poll help status ${response.status}`);
    }
    assert.equal(providerCalls, 0, "no provider call for refused requests");
  } finally {
    globalThis.fetch = originalFetch; withFlags({});
    for (const key of ["COMMONS_COORDINATOR_ONBOARDING_ENABLED", "OPENAI_API_KEY", "COMMONS_POLL_MODEL"]) delete process.env[key];
    await trip.cleanup();
  }
});

test("free beta creation cap: a non-pilot account cannot commit a sixth trip in 24 hours", { skip: !databaseTestsEnabled }, async () => {
  const priorClosedBeta = process.env.COMMONS_CLOSED_BETA_REQUIRED;
  process.env.COMMONS_CLOSED_BETA_REQUIRED = "false";
  const trip = await seedSyntheticTrip({ pilot: false });
  const { commons } = await import("@commons/database");
  const extra = Array.from({ length: 4 }, () => randomUUID());
  try {
    actAs(trip.organizerId);
    withFlags({ COMMONS_PUBLIC_FREE_BETA_ENABLED: "true" });
    // The seeded trip plus four more created by the same organizer today.
    await withTestDatabase(db => db.insert(commons).values(extra.map(id => ({ id, slug: `qa-cap-${id}`, name: "Synthetic cap trip", timezone: "America/Denver", createdByPersonId: trip.organizerId }))));
    const { commitAuthenticatedEventDraft, EventCreationLimitError } = await import("./event-creation");
    await assert.rejects(commitAuthenticatedEventDraft(randomUUID(), { commandId: randomUUID() }), EventCreationLimitError);
    withFlags({});
    await assert.rejects(commitAuthenticatedEventDraft(randomUUID(), { commandId: randomUUID() }), (error: Error) => !(error instanceof EventCreationLimitError), "no cap while the flag is off");
  } finally {
    withFlags({});
    for (const id of extra) await withTestDatabase(db => db.delete(commons).where(eq(commons.id, id)));
    await trip.cleanup();
    if (priorClosedBeta === undefined) delete process.env.COMMONS_CLOSED_BETA_REQUIRED;
    else process.env.COMMONS_CLOSED_BETA_REQUIRED = priorClosedBeta;
  }
});


test("a newly created free trip stays restricted after public signup closes, preserving saved work", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip({ pilot: false });
  const { commons, coordinatorThreads, createEventCreationDraft, commitEventCreationDraft } = await import("@commons/database");
  let createdId: string | undefined;
  try {
    actAs(trip.organizerId);
    withFlags({ COMMONS_PUBLIC_FREE_BETA_ENABLED: "true" });
    const options = { actorPersonId: trip.organizerId, databaseUrl: process.env.TEST_DATABASE_URL };
    const draft = await createEventCreationDraft({ sourceKind: "description", title: "QA weekend with friends", timezone: "America/Denver" }, options);
    const result = await commitEventCreationDraft(draft.id, { commandId: randomUUID(), expectedVersion: draft.version }, options);
    createdId = result.eventId;
    const { resolveTripCapabilities, accountHasPilotCapabilities } = await import("./trip-capabilities");
    // Retained private work can predate the capability change; exercising the guard must preserve it.
    await withTestDatabase(db => db.insert(coordinatorThreads).values({ commonsId: result.eventId, createdByPersonId: trip.organizerId, title: "Private saved planning", lastCommandId: randomUUID(), lastCommandFingerprint: "synthetic-saved-work" }));
    const before = await withTestDatabase(db => db.select().from(coordinatorThreads).where(eq(coordinatorThreads.commonsId, result.eventId)));
    assert.ok(before.length, "the trip has saved private Coordinator work");
    assert.equal((await resolveTripCapabilities(result.eventId)).coordinator, false);
    withFlags({ COMMONS_PUBLIC_FREE_BETA_ENABLED: "false" });
    assert.deepEqual(await resolveTripCapabilities(result.eventId), { tier: "free", coordinator: false, goals: false, pollAssistance: true }, "the same server capability drives rail and mobile Menu after rollback");
    assert.equal(await accountHasPilotCapabilities(trip.organizerId), false);
    const routes = await loadRoutes();
    for (const route of ["coordinator", "turns", "personal", "research", "goals", "recipes"] as const) {
      const response = await routes[route].POST(request(result.eventId, "POST"), context(result.eventId));
      assert.equal(response.status, 403, route);
      assert.equal((await response.json() as { code?: string }).code, "capability_unavailable");
    }
    assert.deepEqual(await withTestDatabase(db => db.select().from(coordinatorThreads).where(eq(coordinatorThreads.commonsId, result.eventId))), before, "rollback and guarded calls never alter saved private work");
  } finally {
    withFlags({});
    if (createdId) await withTestDatabase(db => db.delete(commons).where(eq(commons.id, createdId!)));
    await trip.cleanup();
  }
});
