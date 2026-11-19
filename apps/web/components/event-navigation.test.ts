import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventNavigationLinks } from "./event-navigation";
import type { EventView } from "../lib/commons-route";
import { askEntryHref, askNavigationHref, askPath } from "../lib/ask-route";

test("desktop and mobile share the same four real destination links", async () => {
  const source = await readFile(new URL("./event-navigation.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  assert.deepEqual([...source.matchAll(/id: "(\w+)", label:/g)].map(match => match[1]), ["home", "coordinator", "plan", "money", "moments"]);
  assert.match(source, /item\.id !== "moments" \|\| tripStage !== null/, "Photos only appears on the new experience, so other trips keep four");
  assert.match(source, /href=\{commonsViewPath/);
  assert.match(source, /aria-current=/);
  assert.match(source, /event.metaKey \|\| event.ctrlKey/);
  const header = await readFile(new URL("./global-navigation.tsx", import.meta.url), "utf8");
  assert.equal((app.match(/<EventNavigationLinks /g) ?? []).length, 0);
  assert.equal((header.match(/<EventNavigationLinks /g) ?? []).length, 2);
  assert.match(header, /<dialog ref=\{menu\}/);
  assert.match(header, /aria-expanded=\{menuOpen\}/);
  assert.match(app, /useSearchParams\(\)/);
  assert.doesNotMatch(app, /dispatchEvent\(new PopStateEvent/);
  assert.match(app, /useState<Tab>\(\(\) => availableTab\(initialView\)\)/);
  assert.doesNotMatch(app, /function TripDetailsSheet|setSheet\("trip-details"\)|Lodging not added/);
});

test("Overview stays outside Coordinator navigation and the workspace stays mounted", async () => {
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  const workspace = await readFile(new URL("./coordinator-workspace.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /TripNavigation|onOverview=/);
  assert.match(app, /<div hidden=\{tab !== "home" && tab !== "coordinator"\}><CoordinatorWorkspace/);
  assert.match(workspace, /<main hidden=\{showOverview\}/);
  assert.doesNotMatch(workspace, />Overview<\/button>|workspace-thread-title">Overview/);
});

test("Travel has bounded return destinations and Your trips opens the event index", async () => {
  const source = await readFile(new URL("./travel-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /href="\/trips\/">Your trips/);
  assert.match(source, /commonsViewPath\(snapshot.commons.id, returnView\)/);
  const route = await readFile(new URL("../app/c/[slug]/travel/page.tsx", import.meta.url), "utf8");
  assert.match(route, /redirect\(commonsViewPath\(slug, "logistics"\)\)/);
  assert.doesNotMatch(route, /TravelWorkspace|loadCommonsSnapshot/);
});

test("Logistics uses progressive sections and organizer-only edits without a readiness score", async () => {
  const source = await readFile(new URL("./event-logistics-view.tsx", import.meta.url), "utf8");
  assert.match(source, /<h2>Plan<\/h2>/);
  assert.match(source, /canEditBasics = canManage/);
  assert.match(source, /canEditBasics \? <button[^>]*type="button" onClick=\{editBasics\}/);
  assert.match(source, /readOnly participants=\{participants\}/);
  assert.match(source, /basicsEditor \?\?/);
  assert.match(source, /editingStayId === stay.id && stayEditor/);
  assert.doesNotMatch(source, /Manage people|View people|Manage travel|commonsTravelPath|arrivalCoverage|departureCoverage/);
  assert.doesNotMatch(source, /needs plans|missing|readinessScore|confirmationCode|confirmationDocumentUrl/);
  assert.match(source, /<details className="event-stay-details"/);
  assert.match(source, /<StayAddressActions name=\{stay.name\} address=\{stay.address\}/);
});

test("attendance reloads after dates change and can recover without closing a page", async () => {
  const page = await readFile(new URL("./event-logistics-view.tsx", import.meta.url), "utf8");
  const attendance = await readFile(new URL("./event-attendance.tsx", import.meta.url), "utf8");
  assert.match(page, /key=\{`\$\{commons.id\}:\$\{commons.startsOn\}:\$\{commons.endsOn\}:\$\{peopleRevision\}`\}/);
  assert.match(attendance, /Reload attendance/);
  assert.match(attendance, /\[endpoint, reloadVersion\]/);
  assert.doesNotMatch(attendance, /Close and reopen this panel/);
});

test("Ask the group is a gated organizer destination with persistent Trip Home navigation", async () => {
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  const home = await readFile(new URL("./home-dashboard.tsx", import.meta.url), "utf8");
  const header = await readFile(new URL("./poll-workspace-header.tsx", import.meta.url), "utf8");
  const ask = await readFile(new URL("../app/c/[slug]/ask/page.tsx", import.meta.url), "utf8");
  const start = await readFile(new URL("./recipe-start.tsx", import.meta.url), "utf8");
  const legacy = await readFile(new URL("../app/c/[slug]/recipes/page.tsx", import.meta.url), "utf8");
  const polls = await readFile(new URL("../app/c/[slug]/polls/page.tsx", import.meta.url), "utf8");
  assert.match(app, /recipesAvailable=\{Boolean\(organizerWorkspace\?\.recipesEnabled\)(?: \|\| Boolean\(directGoals\))?\}/);
  assert.match(home, /askEntryHref\(commons\.id, canAskGroup, recipesAvailable, coordinatorAvailable\)/);
  assert.match(ask, /loadAuthenticatedRecipeRuns/);
  assert.match(ask, /loadAuthenticatedPollDrafts/);
  assert.match(ask, /state\.pollRequests/);
  assert.match(ask, /Ask the group/);
  assert.match(ask, /Trip Home/);
  assert.match(header, /askHref \? link\(askHref, askLabel, askCurrent\)/);
  assert.match(start, /<h1>Ask the group<\/h1>/);
  assert.match(start, /\["new", "drafts", "shared", "completed"\]/);
  assert.match(start, /item\.handler === "poll_draft"/);
  assert.match(start, /pollDrafts/);
  assert.match(start, /genericShared/);
  assert.doesNotMatch(start, /item\.id === "transport"|item\.id === "itinerary"/);
  assert.match(legacy, /redirect\(askPath\(slug, await searchParams\)\)/);
  assert.match(polls, /askNavigationHref\(slug, snapshot\.currentActor\.role/);
  assert.match(ask, /loadAuthenticatedRecipeRuns/);
  assert.match(ask, /RecipesDisabledError\) notFound/);
  assert.equal(askPath("trip id", { view: "drafts", keep: ["one", "two"], blank: "" }), "/c/trip%20id/ask?view=drafts&keep=one&keep=two&blank=");
  assert.equal(askNavigationHref("trip-id", "organizer", true), "/c/trip-id/ask", "pilot organizer gets the shared navigation entry");
  assert.equal(askNavigationHref("trip-id", "member", true), undefined, "participants never get the organizer entry");
  assert.equal(askNavigationHref("trip-id", "organizer", false), undefined, "non-pilot organizers do not get the recipe entry");
  assert.equal(askEntryHref("trip-id", true, true), "/c/trip-id/ask", "Trip Home entry opens Ask only for the pilot");
  assert.equal(askEntryHref("trip-id", true, false), "/c/trip-id/coordinator?ask=1", "existing Ask flow remains available outside the pilot");
  assert.equal(askEntryHref("trip-id", false, true), undefined, "Trip Home hides Ask from participants");
});

test("Photos is contextual under Trip and Travel & stays belongs to Plan in the shared destination links", () => {
  Object.assign(globalThis, { React });
  const current = (view: EventView | "workspace") => [...renderToStaticMarkup(createElement(EventNavigationLinks, { eventId: "trip", view, navigate() {} })).matchAll(/aria-current="page"[^>]*><svg[\s\S]*?<span>(.*?)<\/span>/g)].map(match => match[1]);
  assert.deepEqual(current("moments"), ["Trip"]);
  assert.deepEqual(current("home"), ["Trip"]);
  assert.deepEqual(current("logistics"), ["Plan"]);
  assert.deepEqual(current("workspace"), ["Coordinator"]);
  const html = renderToStaticMarkup(createElement(EventNavigationLinks, { eventId: "trip", view: "plan", navigate() {} }));
  assert.match(html, /href="\/c\/trip\?arrival=0&amp;view=money"/, "links keep real hrefs for new-tab and modified clicks");
});
