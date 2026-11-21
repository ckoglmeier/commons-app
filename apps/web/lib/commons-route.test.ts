import assert from "node:assert/strict";
import test from "node:test";
import { commonsPath, commonsSetupPath, commonsWorkspacePath, commonsViewPath, commonsTravelPath, eventLocation, planSectionPath, itemDetailPath, parseEventView, travelReturnView, eventViews, parsePlanSection, planSections, visiblePlanSection } from "./commons-route";

test("builds canonical event URLs from opaque IDs", () => {
  assert.equal(commonsPath("8b26fd00-0000-4000-8000-000000000001"), "/c/8b26fd00-0000-4000-8000-000000000001");
});

test("every primary destination survives a copied URL with an allowlisted view", () => {
  for (const view of eventViews) {
    const url = new URL(commonsViewPath("8b26fd00-0000-4000-8000-000000000001", view), "https://commons.test");
    assert.equal(url.searchParams.get("arrival"), "0");
    assert.equal(eventLocation(url.searchParams), view);
  }
  for (const value of [undefined, null, "", "https://evil.test", "settings", "LOGISTICS"]) assert.equal(parseEventView(value), "home");
});

test("Travel returns to Plan or Logistics without trusting arbitrary return URLs", () => {
  assert.equal(commonsTravelPath("event"), "/c/event?arrival=0&view=plan&section=travel");
  assert.equal(commonsTravelPath("event", "plan"), "/c/event?arrival=0&view=plan&section=travel");
  assert.equal(travelReturnView("plan"), "plan");
  for (const value of [undefined, "logistics", "https://evil.test", "money"]) assert.equal(travelReturnView(value), "logistics");
});

test("builds setup URLs from event IDs", () => {
  assert.equal(
    commonsSetupPath("8b26fd00-0000-4000-8000-000000000001", "review & send"),
    "/c/8b26fd00-0000-4000-8000-000000000001/setup?step=review%20%26%20send",
  );
});

test("builds direct workspace URLs when the trip is already introduced", () => {
  assert.equal(
    commonsWorkspacePath("8b26fd00-0000-4000-8000-000000000001"),
    "/c/8b26fd00-0000-4000-8000-000000000001?arrival=0",
  );
});


test("Plan sections and item details survive copied links, including legacy Logistics", () => {
  assert.equal(eventLocation(new URLSearchParams("view=logistics")), "logistics");
  for (const section of ["schedule", "travel", "ideas"] as const) {
    const url = new URL(planSectionPath("trip", section), "https://commons.test");
    assert.equal(url.searchParams.get("section"), section);
    assert.equal(eventLocation(url.searchParams), section === "travel" ? "logistics" : "plan");
  }
  const url = new URL(itemDetailPath("trip", "stay", "record & 1", "money"), "https://commons.test");
  assert.equal(eventLocation(url.searchParams), "money");
  assert.equal(url.searchParams.get("item"), "stay");
  assert.equal(url.searchParams.get("itemId"), "record & 1");
});

test("Plan section links resolve to the two persistent sections; Map needs its flag", () => {
  assert.equal(parsePlanSection("map", false), "schedule");
  assert.equal(parsePlanSection("map", true), "map");
  assert.equal(parsePlanSection("bogus", true), "schedule");
  assert.equal(parsePlanSection(null, true), "schedule");
  assert.deepEqual(planSections.map(visiblePlanSection), ["schedule", "travel", "schedule", null, "travel"]);
});
