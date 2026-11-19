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

test("held-back pages recover to Trip instead of a dead end", async () => {
  for (const file of ["../app/c/[slug]/ask/page.tsx", "../app/c/[slug]/goals/page.tsx", "../app/c/[slug]/recipes/[runId]/page.tsx", "../app/c/[slug]/recipes/transport/page.tsx"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /if \(!capabilities\.goals\) redirect\(heldFeaturePath\(slug\)\)/, file);
  }
});

test("queued Coordinator work is re-checked against the trip's capability before it runs", async () => {
  const runner = await readFile(new URL("../lib/server/coordinator-turn-runner.ts", import.meta.url), "utf8");
  assert.match(runner, /if \(!\(await resolveTripCapabilities\(claim\.tripId\)\)\.coordinator\) return failClaim\(new CoordinatorTurnError\("unsupported_capability"\)\)/);
  const check = runner.indexOf("resolveTripCapabilities(claim.tripId)"), run = runner.indexOf("runCoordinatorTurn(");
  assert.ok(check > 0 && check < runner.indexOf("runAsTurnPrincipal(", check) && (run < 0 || check < runner.lastIndexOf("runCoordinatorTurn(")), "the check precedes execution");
});

test("beta trips: Trip hands off to direct pages, never to a conversation", async () => {
  const page = await readFile(new URL("../app/c/[slug]/page.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  const planning = await readFile(new URL("./planning-goal.tsx", import.meta.url), "utf8");
  const goalPage = await readFile(new URL("../app/c/[slug]/goals/[goalId]/page.tsx", import.meta.url), "utf8");
  const pollPage = await readFile(new URL("../app/c/[slug]/polls/[pollId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /capabilities\.tier === "beta" && snapshot\.currentActor\.role === "organizer"/, "only the beta organizer loads goals for Trip");
  assert.match(app, /directGoals \? \{[\s\S]*goals: directGoals\.goals/, "saved goals feed Needs you");
  assert.match(app, /router\.push\(goal \? `\$\{commonsPath\(initialSnapshot\.commons\.id\)\}\/goals\/\$\{goal\.goalId\}`/, "a goal opens its page, not a thread");
  assert.match(planning, /\{conversationAvailable \? <Link[^>]*>Build with Coordinator<\/Link> : null\}/, "no Coordinator link without the capability");
  assert.match(goalPage, /if \(!runId && capabilities\.coordinator\) redirect/, "a goal without a workflow stays on its own page");
  assert.match(pollPage, /capabilities\.tier !== "beta" \? <Link className="cm-action" href=\{`\/c\/\$\{slug\}\/coordinator\?poll=/, "Open in Workspace is not offered on a beta trip; free and pilot trips are unchanged");
});
