import assert from "node:assert/strict";
import test from "node:test";
import { fileTitle, placeHintsFromText } from "./place-file";

test("suggests a name and the first link from a PDF's text", () => {
  assert.deepEqual(placeHintsFromText("\n  Gundlach Bundschu Winery \nTastings daily\nhttps://www.gunbun.com/visit.\n", "brochure.pdf"),
    { title: "Gundlach Bundschu Winery", url: "https://www.gunbun.com/visit", readable: true });
  assert.deepEqual(placeHintsFromText("", "Glen Ellen cottage.pdf"), { title: "Glen Ellen cottage", url: null, readable: false });
});

test("ignores camera and screenshot file names", () => {
  assert.equal(fileTitle("IMG_4821.jpeg"), null);
  assert.equal(fileTitle("Screenshot 2026-10-15 at 9.41.22 AM.png"), null);
  assert.equal(fileTitle("sonoma-plaza-farmers-market.png"), "sonoma plaza farmers market");
});
