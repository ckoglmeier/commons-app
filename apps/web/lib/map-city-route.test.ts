import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { GET } from "../app/api/v1/map-cities/route";

test("city lookup uses current city names, excludes airports/old aliases, and leaves ambiguous cities for a person to choose", async () => {
  const lookup = async (query: string) => {
    const response = await GET(new Request(`http://localhost/api/v1/map-cities?q=${encodeURIComponent(query)}`));
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
    return (await response.json()).matches;
  };
  const sonoma = await lookup("Sonoma");
  assert.equal(sonoma.length, 1); assert.equal(sonoma[0].label, "Sonoma, California, United States");
  assert.ok(Math.abs(sonoma[0].latitude - 38.29) < 0.01 && Math.abs(sonoma[0].longitude + 122.46) < 0.01);
  assert.deepEqual(Object.keys(sonoma[0]).sort(), ["id", "label", "latitude", "longitude"]);
  assert.ok((await lookup("Santa Fe")).length > 1);
  const qualified = await lookup("Santa Fe, NM");
  assert.equal(qualified.length, 1); assert.match(qualified[0].label, /New Mexico/);
  assert.deepEqual(await lookup("SFO"), []);
  assert.deepEqual(await lookup("Unknown city qzxqzx"), []);
  assert.equal((await GET(new Request(`http://localhost/api/v1/map-cities?q=${"x".repeat(121)}`))).status, 400);
});

test("city centers retain the same pinned source as the existing catalog and match their generated hash", async () => {
  const manifest = JSON.parse(await readFile("lib/server/data/city-map-centers-manifest.json", "utf8"));
  const original = JSON.parse(await readFile("lib/server/data/location-timezones-manifest.json", "utf8"));
  assert.equal(manifest.source.sha256, original.sources[0].sha256);
  assert.equal(manifest.cities, original.cities);
  assert.equal(createHash("sha256").update(await readFile("lib/server/data/city-map-centers.json.gz")).digest("hex"), manifest.sha256);
});
