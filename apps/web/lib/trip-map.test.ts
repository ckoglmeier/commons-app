import assert from "node:assert/strict";
import test from "node:test";
import type { ItineraryItem, Stay } from "@commons/contracts";
import { directionsUrl, distanceLabel, filterTripMapPlaces, stayDistances, tripMapDays, tripMapPlaces } from "./trip-map";

const stay = (id: string, extra: Partial<Stay> = {}): Stay => ({ id, name: id, address: `${id} address`, startsOn: "2027-11-05", endsOn: "2027-11-07",
  status: "considering", includedPersonIds: ["p1"], sourceLabel: "Added by CK", ...extra });
const item = (id: string, extra: Partial<ItineraryItem> = {}): ItineraryItem => ({ id, title: id, startsAt: null, participantScope: "everyone",
  status: "idea", provenanceLabel: "Added", ...extra });
const lodge = { latitude: 38.2797, longitude: -122.4585, precision: "exact" as const, source: "page" as const };
const plaza = { latitude: 38.2933, longitude: -122.458, precision: "exact" as const, source: "map_link" as const };
const glenEllen = { latitude: 38.3644, longitude: -122.5242, precision: "approximate" as const, source: "placed" as const };

test("lists stays and activities with saved pins only, leaving unplaced places in the list", () => {
  const places = tripMapPlaces([stay("Lodge", { pin: lodge })], [
    item("Plaza", { pin: plaza }), item("Winery"), item("Dinner at home", { mealType: "home" }), item("Old plan", { status: "cancelled" }),
    item("Timed", { startsAt: "2027-11-06T03:30:00.000Z" }),
  ], "America/Los_Angeles");
  assert.deepEqual(places.map(place => [place.name, place.statusLabel, Boolean(place.pin)]),
    [["Lodge", "Considering", true], ["Plaza", "Idea", true], ["Winery", "Idea", false], ["Timed", "Idea", false]]);
  // An evening start in California belongs to the local day, not the UTC day.
  assert.equal(places.find(place => place.name === "Timed")?.day, "2027-11-05");
});

test("day filters narrow activities while stays stay visible", () => {
  const places = tripMapPlaces([stay("Lodge")], [item("Fri", { scheduledDate: "2027-11-06" }), item("Someday")], "America/Los_Angeles");
  assert.deepEqual(filterTripMapPlaces(places, { kind: "all", day: "2027-11-06" }).map(place => place.name), ["Lodge", "Fri"]);
  assert.deepEqual(filterTripMapPlaces(places, { kind: "all", day: "undated" }).map(place => place.name), ["Lodge", "Someday"]);
  assert.deepEqual(filterTripMapPlaces(places, { kind: "activity", day: "any" }).map(place => place.name), ["Fri", "Someday"]);
  assert.deepEqual(tripMapDays("2027-11-05", "2027-11-07", places), ["2027-11-05", "2027-11-06", "2027-11-07"]);
});

test("compares stays by straight-line distance and counts places not yet on the map", () => {
  const places = tripMapPlaces([stay("Lodge", { pin: lodge }), stay("House", { pin: glenEllen }), stay("Unplaced")],
    [item("Plaza", { pin: plaza }), item("Winery")], "America/Los_Angeles");
  const [lodgeRow, houseRow, unplacedRow] = stayDistances(places);
  assert.equal(distanceLabel(lodgeRow.nearestKm!), "0.9 mi");
  assert.equal(lodgeRow.unplacedCount, 1);
  assert.ok(houseRow.nearestKm! > lodgeRow.nearestKm!);
  assert.equal(unplacedRow.nearestKm, null);
  assert.equal(distanceLabel(1.5, "fr-FR"), "1,5 km");
});

test("offers directions only between exact places", () => {
  assert.equal(directionsUrl(lodge, plaza), "https://www.google.com/maps/dir/?api=1&origin=38.279700,-122.458500&destination=38.293300,-122.458000");
  assert.equal(directionsUrl(glenEllen, plaza), null);
});
