import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/api/v1/location-timezones/route";

test("public location search is bounded and returns only public location labels and IANA identifiers", async () => {
  const tooLong = await GET(new Request(`http://localhost/api/v1/location-timezones?q=${"a".repeat(121)}`));
  assert.equal(tooLong.status, 400);
  const response = await GET(new Request("http://localhost/api/v1/location-timezones?q=Falmouth%20MA"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const data = await response.json();
  assert.ok(data.matches.length > 0 && data.matches.length <= 8);
  for (const match of data.matches) assert.deepEqual(Object.keys(match).sort(), ["id", "label", "timezone"]);
  assert.ok(data.matches.some((match: { timezone: string }) => match.timezone === "America/New_York"));
  const empty = await GET(new Request("http://localhost/api/v1/location-timezones?q=x"));
  assert.deepEqual(await empty.json(), { matches: [] });
});

test("the shipped catalog matches its pinned source manifest", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const manifest = JSON.parse(await readFile("lib/server/data/location-timezones-manifest.json", "utf8"));
  const bytes = await readFile("lib/server/data/location-timezones.json.gz");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.sha256);
  assert.ok(manifest.cities > 150_000 && manifest.airports > 7_000);
});
