import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { coverSketchId, coverSketchIds, coverSketchUrl } from "./cover-sketch";

test("explicit themes choose a sketch, with neutral defaults for uncertainty", () => {
  const names = ["Ski weekend", "Hiking weekend", "Beach week", "Lake visit", "Cabin retreat", "Desert trip", "Vineyard weekend", "City break", "Dinner together", "Picnic", "Birthday", "Friends together"];
  names.forEach((name, index) => assert.equal(coverSketchId({ name }), coverSketchIds[index]));
  for (const name of ["Beach or city?", "Lake and cabin", "Maybe skiing", "December trip", "Skills workshop"]) assert.equal(coverSketchId({ name }), "together");
  assert.equal(coverSketchId({ name: "Ski mountains" }), "mountains");
  assert.equal(coverSketchId({ name: "Weekend", locationName: "Lake Tahoe" }), "lake");
  assert.equal(coverSketchUrl({ name: "../../untrusted" }), "/covers/together.svg");
});

test("all defaults remain tiny self-contained SVGs", () => {
  let total = 0;
  for (const id of coverSketchIds) {
    const svg = readFileSync(new URL(`../public/covers/${id}.svg`, import.meta.url));
    total += svg.length;
    assert.ok(svg.length < 1024, `${id} exceeds 1 KB`);
    assert.match(svg.toString(), /viewBox="0 0 360 210"/);
    assert.doesNotMatch(svg.toString(), /<script|<image|<foreignObject|href=|data:|@import|url\(/i);
  }
  assert.ok(total < 8192);
});
