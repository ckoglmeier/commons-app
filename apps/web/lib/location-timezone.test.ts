import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLocationSearch, airportTimezone } from "./location-timezone";
import { locationTimezones } from "./server/location-timezone-catalog";

test("normalizes accents, punctuation and whitespace without losing non-Latin names", () => {
  assert.equal(normalizeLocationSearch("  São-Paulo, BR  "), "sao paulo br");
  assert.equal(normalizeLocationSearch("東京"), "東京");
});

test("broad city and airport catalog covers prefixes, qualifiers, aliases and IANA zones", async () => {
  const cases = [
    ["edin", "Edinburgh", "Europe/London"], ["EDI", "Edinburgh", "Europe/London"],
    ["Glasgow", "Glasgow", "Europe/London"], ["GLA", "Glasgow", "Europe/London"],
    ["Inverness", "Inverness", "Europe/London"], ["Kiruna", "Kiruna", "Europe/Stockholm"],
    ["Falmouth MA", "Massachusetts", "America/New_York"], ["Falmouth Cornwall", "Falmouth", "Europe/London"],
    ["Reykjavik", "Reykjav", "Atlantic/Reykjavik"], ["Sao Paulo", "São Paulo", "America/Sao_Paulo"],
    ["Munich", "Munich", "Europe/Berlin"], ["München", "Munich", "Europe/Berlin"], ["Portland ME", "Maine", "America/New_York"],
    ["JNB", "Johannesburg", "Africa/Johannesburg"], ["AKL", "Auckland", "Pacific/Auckland"],
    ["Heathrow", "Heathrow", "Europe/London"], ["SFO", "San Francisco", "America/Los_Angeles"],
  ];
  for (const [query, label, zone] of cases) {
    const matches = await locationTimezones(query);
    assert.ok(matches.some(match => match.label.includes(label) && match.timezone === zone), `${query}: ${JSON.stringify(matches)}`);
    assert.ok(matches.length <= 8);
    assert.equal(new Set(matches.map(match => match.id)).size, matches.length);
  }
  assert.equal((await locationTimezones("EDI"))[0].id.startsWith("airport:"), true, "exact IATA codes rank first");
  assert.match((await locationTimezones("Falmouth MA"))[0].label, /^Falmouth, Massachusetts/);
  const springfields = await locationTimezones("Springfield");
  assert.ok(new Set(springfields.map(match => match.timezone)).size > 1, "ambiguous cities retain their own timezone");
  assert.deepEqual(await locationTimezones("e"), []);
  assert.deepEqual(await locationTimezones("not-a-real-city-xxyy"), []);
  assert.deepEqual(await locationTimezones("x".repeat(121)), []);
});

test("flight suggestions use exact unambiguous codes from the global airport snapshot", () => {
  assert.equal(airportTimezone(" edi "), "Europe/London");
  assert.equal(airportTimezone("AKL"), "Pacific/Auckland");
  assert.equal(airportTimezone("JNB"), "Africa/Johannesburg");
  assert.equal(airportTimezone("ED"), undefined);
  assert.equal(airportTimezone("Edinburgh"), undefined);
  assert.equal(airportTimezone("ZZZ"), undefined);
});
