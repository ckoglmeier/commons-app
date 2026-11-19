import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { normalizeLocationSearch, type LocationTimezoneMatch } from "../location-timezone";

type City = [string, string, string, string, string, string, string, number, string, string];
type Airport = [string, string, string, string, string, string, string];
type Entry = { id: string; names: string[]; primary: string[]; context: string; label: string; timezone: string; population: number; code?: string };
type Index = Map<string, Entry[]>;
const countries = new Intl.DisplayNames(["en"], { type: "region" });
let catalog: Promise<Index> | undefined;

async function loadCatalog(): Promise<Index> {
  const root = process.cwd();
  const bytes = await readFile(join(root, "lib/server/data/location-timezones.json.gz")).catch(error => {
    if (error.code !== "ENOENT") throw error;
    return readFile(join(root, "apps/web/lib/server/data/location-timezones.json.gz"));
  });
  const data = JSON.parse(gunzipSync(bytes).toString("utf8")) as { cities: City[]; airports: Airport[] };
  const index: Index = new Map();
  const validZones = new Map<string, boolean>();
  const add = (entry: Entry) => {
    let valid = validZones.get(entry.timezone);
    if (valid === undefined) {
      try { new Intl.DateTimeFormat("en", { timeZone: entry.timezone }); valid = true; } catch { valid = false; }
      validZones.set(entry.timezone, valid);
    }
    if (!valid) return;
    for (const prefix of new Set(entry.names.filter(name => name.length >= 2).map(name => name.slice(0, 2)))) {
      const bucket = index.get(prefix) ?? [];
      bucket.push(entry); index.set(prefix, bucket);
    }
  };
  for (const [id, name, ascii, aliases, region, country, timezone, population, regionCode, district] of data.cities) {
    const countryName = countries.of(country) ?? country;
    const label = [name, region, countryName].filter(Boolean).join(", ");
    add({ id: `city:${id}`, names: [...new Set([name, ascii, ...aliases.split(",")].map(normalizeLocationSearch).filter(Boolean))], primary: [name, ascii].map(normalizeLocationSearch), context: normalizeLocationSearch(`${region} ${regionCode} ${district} ${countryName} ${country}`), label, timezone, population });
  }
  for (const [id, name, city, region, country, timezone, code] of data.airports) {
    const countryName = countries.of(country) ?? country;
    add({ id: `airport:${id}`, code: code.toLowerCase(), names: [...new Set([name, city, code, ...name.split(" ").map((_, index, words) => words.slice(index).join(" "))].map(normalizeLocationSearch))], primary: [name, city, code].map(normalizeLocationSearch), context: normalizeLocationSearch(`${city} ${region} ${countryName} ${country}`), label: `${code} · ${[name, city, region, countryName].filter(Boolean).join(", ")}`, timezone, population: 0 });
  }
  return index;
}

export async function locationTimezones(query: string): Promise<LocationTimezoneMatch[]> {
  const text = normalizeLocationSearch(query);
  if (text.length < 2 || query.length > 120) return [];
  catalog ??= loadCatalog().catch(error => { catalog = undefined; throw error; });
  const index = await catalog;
  const tokens = text.split(" ");
  const matches = (index.get(text.slice(0, 2)) ?? []).flatMap(entry => {
    const name = entry.names.find(name => name.startsWith(text)) ?? entry.names.find(name => name.startsWith(tokens[0]) && tokens.slice(1).every(token => `${name} ${entry.context}`.split(" ").some(word => word.startsWith(token))));
    if (!name) return [];
    const words = `${name} ${entry.context}`.split(" ");
    const qualifierPenalty = tokens.slice(1).every(token => words.includes(token)) ? 0 : 1;
    // Current primary names and exact region codes outrank historical aliases.
    const score = entry.code === text ? -1 : (entry.code ? 6 : entry.primary.includes(name) ? 0 : 4) + (name === text ? 0 : 1) + qualifierPenalty;
    return [{ entry, score }];
  });
  matches.sort((a, b) => a.score - b.score || b.entry.population - a.entry.population || a.entry.label.localeCompare(b.entry.label));
  return matches.slice(0, 8).map(({ entry }) => ({ id: entry.id, label: entry.label, timezone: entry.timezone }));
}
