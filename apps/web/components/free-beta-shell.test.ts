import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { askEntryHref } from "../lib/ask-route";

test("free trips ask the group in the standalone poll editor; pilot trips keep the existing entry", () => {
  assert.equal(askEntryHref("trip-1", true, false, false), "/c/trip-1/polls/new");
  assert.equal(askEntryHref("trip-1", true, true, false), "/c/trip-1/ask", "a beta trip (direct goals, no Coordinator) opens Ask the group");
  assert.equal(askEntryHref("trip-1", false, true, false), undefined, "travelers get no organizer entry");
  assert.equal(askEntryHref("trip-1", true, false), "/c/trip-1/coordinator?ask=1");
  assert.equal(askEntryHref("trip-1", true, true), "/c/trip-1/ask");
});

test("Trip · Plan · Money on free trips: rail and Menu share one filtered list; the server decides", async () => {
  const navigation = await readFile(new URL("./event-navigation.tsx", import.meta.url), "utf8");
  const shell = await readFile(new URL("./trip-application-shell.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/c/[slug]/page.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  assert.match(navigation, /filter\(item => \(showCoordinator \|\| item\.id !== "coordinator"\)/);
  assert.equal((shell.match(/showCoordinator=\{coordinatorAvailable\}/g) ?? []).length, 2, "rail and mobile Menu");
  assert.match(page, /const capabilities = await tripCapabilitiesFor\(snapshot\.commons\.id\)/);
  assert.match(page, /capabilities\.coordinator && snapshot\.currentActor\.role === "organizer" && !isPublicDemoCommonsIdentifier\(identifier\) \? await tripCoordinator/, "no workspace or main thread on a free trip");
  assert.match(page, /capabilities\.coordinator && snapshot\.currentActor\.role !== "organizer"/, "no personal history on a free trip");
  assert.match(page, /coordinator=\{capabilities\.coordinator \?/);
  assert.match(app, /availableTab\(eventLocation\(search\)\)/, "back/forward cannot reopen Coordinator");
  assert.match(app, /<TripTasks showSuggestions=\{false\} slug=\{initialSnapshot\.commons\.id\}/, "ordinary to-dos are on Trip, once");
});

test("queued Coordinator work is re-checked against the trip's capability before it runs", async () => {
  const runner = await readFile(new URL("../lib/server/coordinator-turn-runner.ts", import.meta.url), "utf8");
  assert.match(runner, /if \(!\(await resolveTripCapabilities\(claim\.tripId\)\)\.coordinator\) return failClaim\(new CoordinatorTurnError\("unsupported_capability"\)\)/);
  const check = runner.indexOf("resolveTripCapabilities(claim.tripId)"), run = runner.indexOf("runCoordinatorTurn(");
  assert.ok(check > 0 && check < runner.indexOf("runAsTurnPrincipal(", check) && (run < 0 || check < runner.lastIndexOf("runCoordinatorTurn(")), "the check precedes execution");
});
