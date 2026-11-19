import assert from "node:assert/strict";
import test from "node:test";
import { coverCardDimensions } from "./cover-image";

test("cover cards shrink landscape images within the stored card bounds", () => {
  assert.deepEqual(coverCardDimensions(2400, 1600), { width: 720, height: 480 });
});

test("cover cards preserve portrait proportions and do not upscale", () => {
  assert.deepEqual(coverCardDimensions(1600, 2400), { width: 320, height: 480 });
  assert.deepEqual(coverCardDimensions(390, 260), { width: 390, height: 260 });
});
