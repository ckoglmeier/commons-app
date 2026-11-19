import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TravelPlan } from "@commons/contracts";
import { TravelArrangements } from "./travel-arrangements";
test("arrangement preview deduplicates IDs, never inferred routes, and omits unauthorized private records", () => {
  const plan: TravelPlan = { id: "a", personId: "owner", personName: "Owner", personIds: ["one", "two"], kind: "arrival", date: "2026-12-20", route: "Shared flight", note: "", sourceLabel: "Owner", visibility: "basic" };
  const html = renderToStaticMarkup(createElement(TravelArrangements, { plans: [plan, plan, { ...plan, id: "b" }, { ...plan, id: "private", route: "Secret route", visibility: "private" }], people: [], actorId: "outsider" }));
  assert.equal((html.match(/Shared flight/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Secret route/);
});
