import assert from "node:assert/strict";
import test from "node:test";
import { directionsUrl, distanceLabel, filterTripMapPlaces, pinSourceLabel, placeLocationNote, stayDistances, tripMapPlaces } from "../trip-map";

// BR-06 audit: the places on the map are the saved stays and activities, a point exists only when a person saved one, and nothing implies routing.
const stay = (over: Record<string, unknown> = {}) => ({ id: "s1", name: "Pine Cabin", status: "considering", address: null, bookingUrl: null, pin: null, ...over });
const activity = (over: Record<string, unknown> = {}) => ({ id: "a1", title: "Kayak", status: "idea", location: null, sourceUrl: null, pin: null, scheduledDate: null, startsAt: null, mealType: null, ...over });

test("the map places are the saved records, with no invented coordinates", () => {
  const places = tripMapPlaces([stay({ address: "12 Lake Rd, Tahoe City" }), stay({ id: "s2", name: "No address" })] as never, [activity({ location: "Boat ramp" }), activity({ id: "a2", title: "Cancelled", status: "cancelled" }), activity({ id: "a3", title: "Dinner at home", mealType: "home" })] as never, "America/Denver");
  assert.deepEqual(places.map(place => place.name), ["Pine Cabin", "No address", "Kayak"], "cancelled plans and at-home meals have no place to show");
  assert.ok(places.every(place => place.pin === null), "an address alone never becomes a point");
});

test("unknown addresses and unplaced places say so plainly", () => {
  assert.match(placeLocationNote({ pin: null, address: "12 Lake Rd" }), /Address saved, but not on the map yet\. Commons doesn’t guess/);
  assert.match(placeLocationNote({ pin: null, address: null }), /No address saved, and not on the map yet/);
  const pin = { latitude: 39.1, longitude: -120.1, precision: "exact", source: "placed" } as never;
  assert.equal(placeLocationNote({ pin, address: null }), pinSourceLabel(pin));
});

test("distances are straight-line and directions need two exact, person-saved points", () => {
  const exact = { latitude: 39.1, longitude: -120.1, precision: "exact", source: "placed" } as never;
  const area = { latitude: 39.2, longitude: -120.2, precision: "approximate", source: "placed" } as never;
  assert.equal(directionsUrl(exact, area), null, "an approximate area is never sent as a route endpoint");
  assert.ok(directionsUrl(exact, exact)?.startsWith("https://www.google.com/maps/dir/"), "directions are an external handoff, not live routing");
  assert.match(distanceLabel(1.6), /mi|km/);
  const places = tripMapPlaces([stay({ pin: exact })] as never, [activity({ pin: area })] as never, "UTC");
  const compared = stayDistances(places);
  assert.equal(compared[0]?.distances.length, 1);
  assert.equal(filterTripMapPlaces(places, { kind: "activity", day: "any" }).length, 1);
});
