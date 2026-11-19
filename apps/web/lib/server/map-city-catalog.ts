import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { locationTimezones } from "./location-timezone-catalog";
import { normalizeLocationSearch } from "../location-timezone";
import type { MapCity } from "../map-city";

let centers: Promise<Map<string, [number, number]>> | undefined;
async function loadCenters() {
  const bytes = await readFile(join(process.cwd(), "lib/server/data/city-map-centers.json.gz")).catch(error => {
    if (error.code !== "ENOENT") throw error;
    return readFile(join(process.cwd(), "apps/web/lib/server/data/city-map-centers.json.gz"));
  });
  const rows = JSON.parse(gunzipSync(bytes).toString("utf8")) as [string, number, number][];
  return new Map(rows.map(([id, latitude, longitude]) => [`city:${id}`, [latitude, longitude] as [number, number]]));
}

/** Public, offline city lookup. Never geocodes addresses or saved place text.
 * Historical aliases and airports cannot silently become a destination city. */
export async function mapCities(query: string): Promise<MapCity[]> {
  const text = normalizeLocationSearch(query);
  if (text.length < 2 || query.length > 120) return [];
  const matches = (await locationTimezones(query)).filter(match => {
    const name = normalizeLocationSearch(match.label.split(",")[0]);
    return match.id.startsWith("city:") && (text === name || text.startsWith(`${name} `));
  });
  centers ??= loadCenters().catch(error => { centers = undefined; throw error; });
  const index = await centers;
  return matches.flatMap(({ id, label }) => {
    const point = index.get(id);
    return point && Number.isFinite(point[0]) && Math.abs(point[0]) <= 85.05112878 && Number.isFinite(point[1]) && Math.abs(point[1]) <= 180
      ? [{ id, label, latitude: point[0], longitude: point[1] }] : [];
  });
}
