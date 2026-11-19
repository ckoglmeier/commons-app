import test from "node:test";
import assert from "node:assert/strict";
import { safeAuthNext } from "../auth-flow";
import { parseTripEntryContext, tripEntryPath, tripEntrySignInPath } from "./context";

const draft = "11111111-1111-4111-8111-111111111111";

test("entry context keeps only well-formed public identifiers", () => {
  assert.deepEqual(parseTripEntryContext({ template: "girls-trip", destination: "napa", source: "template", brief: "private text" }), { template: "girls-trip", destination: "napa", source: "template" });
  assert.deepEqual(parseTripEntryContext({ template: "Not A Slug", destination: "<x>", source: "elsewhere" }), {});
  assert.deepEqual(parseTripEntryContext({ template: ["a"], destination: 3 }), {});
});

test("the catalog interface can refuse what the website doesn't publish", () => {
  const catalog = { isTemplate: (slug: string) => slug === "known", isDestination: () => false };
  assert.deepEqual(parseTripEntryContext({ template: "known", destination: "napa" }, catalog), { template: "known" });
  assert.deepEqual(parseTripEntryContext({ template: "unknown" }, catalog), {});
});

test("sign-in preserves context and draft identity, and nothing private enters the URL", () => {
  assert.equal(tripEntryPath({ template: "coast" }, draft), `/new?template=coast&draft=${draft}`);
  assert.equal(tripEntryPath({}, "../evil"), "/new");
  const target = new URL(tripEntrySignInPath({ source: "template", template: "coast" }, draft), "https://x.invalid");
  assert.equal(target.searchParams.get("intent"), "create");
  assert.equal(safeAuthNext(target.searchParams.get("next")), `/new?source=template&template=coast&draft=${draft}`.replace("source=template&template=coast", "template=coast&source=template"));
});
