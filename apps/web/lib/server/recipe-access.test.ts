import test from "node:test";
import assert from "node:assert/strict";
import { registerComponentImportStubs } from "../test-support/hook-harness";
registerComponentImportStubs();

const trip = "96000000-0000-4000-8000-0000000000aa", other = "96000000-0000-4000-8000-0000000000bb";
const pilot = { COMMONS_RECIPES_ENABLED: "false", COMMONS_RECIPES_PILOT_EMAILS: " Pilot@Example.com ,second@example.com", COMMONS_RECIPES_PILOT_TRIP_IDS: trip.toUpperCase() };
const verified = { authUserId: "verified-subject", email: "pilot@example.com" };

test("recipes are on by default; turned off, the pilot requires a verified listed account AND a listed trip", async () => {
  const { recipeAccessAllowed } = await import("./recipe-access");
  assert.equal(recipeAccessAllowed({}, null, null), true, "on for every account unless turned off");
  assert.equal(recipeAccessAllowed({ COMMONS_RECIPES_ENABLED: "false" }, verified, trip), false, "turned off with no pilot lists");
  assert.equal(recipeAccessAllowed(pilot, verified, trip), true);
  assert.equal(recipeAccessAllowed(pilot, verified, other), false, "eligible account on another trip");
  assert.equal(recipeAccessAllowed(pilot, { authUserId: "x", email: "outsider@example.com" }, trip), false, "allowed trip, unlisted account");
  assert.equal(recipeAccessAllowed(pilot, { authUserId: "", email: "pilot@example.com" }, trip), false, "no verified subject");
  assert.equal(recipeAccessAllowed(pilot, null, trip), false, "local pilot actor or signed out");
  assert.equal(recipeAccessAllowed(pilot, verified, null), false, "unknown trip");
  assert.equal(recipeAccessAllowed({ ...pilot, COMMONS_RECIPES_PILOT_TRIP_IDS: "" }, verified, trip), false, "trip list empty");
  assert.equal(recipeAccessAllowed({ ...pilot, COMMONS_RECIPES_PILOT_EMAILS: " , " }, verified, trip), false, "email list empty");
  assert.equal(recipeAccessAllowed({ COMMONS_RECIPES_ENABLED: "true" }, null, null), true, "global flag keeps its existing meaning");
  assert.equal(recipeAccessAllowed({ ...pilot, COMMONS_RECIPES_ENABLED: "false" }, verified, trip), true);
});

test("recipe availability fails closed for an unknown trip regardless of global recipe switches", async () => {
  const { recipesAvailableFor } = await import("./recipe-access");
  assert.equal(await recipesAvailableFor(trip, {}), false);
  assert.equal(await recipesAvailableFor(trip, { COMMONS_RECIPES_ENABLED: "false" }), false);
  assert.equal(await recipesAvailableFor(trip, { COMMONS_RECIPES_ENABLED: "true" }), false);
  // The test process has no Supabase session, so a listed trip alone grants nothing.
  assert.equal(await recipesAvailableFor(trip, { ...pilot, COMMONS_RECIPES_ENABLED: "false" }), false);
});

test("itinerary portability pilot stays scoped even when recipes are globally enabled", async () => {
  const { itineraryPortabilityAvailableFor } = await import("./itinerary-portability");
  const { readCommonsRuntimeEnvironment } = await import("./runtime-environment");
  const environment = readCommonsRuntimeEnvironment({ NODE_ENV: "test", ...pilot, COMMONS_ASSISTANT_UI_ENABLED: "true", COMMONS_RECIPES_ENABLED: "true", COMMONS_ITINERARY_PORTABILITY_PILOT_ENABLED: "true" });
  assert.equal(await itineraryPortabilityAvailableFor(trip, environment), false, "no verified session: global recipes cannot bypass pilot identity");
  assert.equal(await itineraryPortabilityAvailableFor(other, environment), false);
  assert.equal(await itineraryPortabilityAvailableFor(trip, { ...environment, COMMONS_ITINERARY_PORTABILITY_ENABLED: "true" }), true, "explicit global portability retains its meaning");
  assert.equal(await itineraryPortabilityAvailableFor(trip, { ...environment, COMMONS_ASSISTANT_UI_ENABLED: "false" }), false);
});
